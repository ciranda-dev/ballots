// Three people vote in an Autobase room. Each signs their votes with their own key, every peer's
// apply checks them the same way, and every peer ends up with the same tally.
//
//   node examples/autobase.js
//   bare examples/autobase.js

const Autobase = require('autobase')
const Corestore = require('corestore')
const Hyperbee = require('hyperbee')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const tmp = require('test-tmp')
const { replicateAndSync } = require('autobase-test-helpers')
const ballots = require('..')

const VOTE = 'ballots-example/vote'
const CLOSE = 'ballots-example/close'

// The view, the same on every peer: members/<voter>, writers/<writer>, ballots/<id>,
// votes/<id>/<voter>/<n> (every version a voter wrote) and closes/<id>.

function open(store) {
  return new Hyperbee(store.get('view'), {
    keyEncoding: 'utf-8',
    valueEncoding: 'json',
    extension: false
  })
}

// apply runs every record on every peer, forever. Each field is checked before it is used, so a
// malformed record is skipped instead of throwing.
async function apply(nodes, view, host) {
  for (const { from, value } of nodes) {
    if (value === null || typeof value !== 'object') continue
    if (value.type === 'member') await applyMember(from, value, view, host)
    else if (value.type === 'ballot') await applyBallot(from, value, view)
    else if (value.type === 'vote') await applyVote(value, view, host)
    else if (value.type === 'close') await applyClose(value, view, host)
  }
}

// Only the room's creator, its bootstrap writer, admits members: a voter key and the writer their
// device appends with.
async function applyMember(from, { writer, voter, name }, view, host) {
  if (!b4a.equals(from.key, host.key)) return
  if (!isKey(writer) || !isKey(voter) || !isText(name)) return
  if (writer !== hex(host.key)) await host.addWriter(b4a.from(writer, 'hex'), { indexer: false })
  await view.put('members/' + voter, { name, writer })
  await view.put('writers/' + writer, { voter })
}

// A member opens a ballot from their own writer, and is the one who may close it.
async function applyBallot(from, { id, question, options, mode, levels }, view) {
  const writer = await view.get('writers/' + hex(from.key))
  if (!writer || !isId(id) || !isText(question)) return
  if (!Array.isArray(options) || !options.every(isText)) return
  const definition = ballots.define({ options: options.length, mode, levels })
  if (!definition || (await view.get('ballots/' + id))) return
  const { voter: by } = writer.value
  await view.put('ballots/' + id, { id, question, options, mode, levels, by })
}

async function applyVote({ ballot: id, voter, n, choices, signature }, view, host) {
  const ballot = isId(id) ? await view.get('ballots/' + id) : null
  if (!ballot || !isKey(voter) || !isSignature(signature)) return
  const vote = { voter, n, choices }
  if (!ballots.isVote(definitionOf(ballot.value), vote)) return
  vote.tie = ballots.signable({ ballot: id, n, choices }, { domain: VOTE, scope: hex(host.key) })
  if (!verify(vote.tie, signature, voter)) return
  if (!(await view.get('members/' + voter))) return
  const key = voteKey(id, voter, n)
  const same = await view.get(key)
  // Once the ballot is closed, a stored version is never replaced: a second version with the same
  // n, written after the close, could otherwise win on its tie and change the closed result.
  const closed = await view.get('closes/' + id)
  if (same && (closed || ballots.prefer(same.value, vote) === same.value)) return
  await view.put(key, { ...vote, signature })
}

// The first valid close stands. It is signed by whoever opened the ballot, and lists only votes
// this view holds.
async function applyClose({ ballot: id, counted, signature }, view, host) {
  const ballot = isId(id) ? await view.get('ballots/' + id) : null
  if (!ballot || !isSignature(signature) || (await view.get('closes/' + id))) return
  if (!ballots.isCut(definitionOf(ballot.value), counted)) return
  const text = ballots.signableClose(
    { ballot: id, counted },
    { domain: CLOSE, scope: hex(host.key) }
  )
  if (!verify(text, signature, ballot.value.by)) return
  for (const [voter, n] of counted) {
    if (!(await view.get(voteKey(id, voter, n)))) return
  }
  await view.put('closes/' + id, { counted, signature })
}

// Reading the view

async function votesOf(view, id) {
  const votes = []
  const range = { gt: `votes/${id}/`, lt: `votes/${id}/~` }
  for await (const { value } of view.createReadStream(range)) votes.push(value)
  return votes
}

async function resultOf(view, id) {
  const ballot = (await view.get('ballots/' + id)).value
  const close = await view.get('closes/' + id)
  const stored = await votesOf(view, id)
  const tally = ballots.tally(definitionOf(ballot), stored, close && close.value)
  return { ballot, close: close && close.value.counted, stored, tally }
}

// The records a device appends. A vote or a close carries its signer's signature over the text the
// package gives for it, so any device can relay it and every peer can check it.

function voteRecord(keyPair, scope, { ballot, voter = hex(keyPair.publicKey), n, choices }) {
  const text = ballots.signable({ ballot, n, choices }, { domain: VOTE, scope })
  return { type: 'vote', ballot, voter, n, choices, signature: sign(text, keyPair) }
}

function closeRecord(keyPair, scope, { ballot, counted }) {
  const text = ballots.signableClose({ ballot, counted }, { domain: CLOSE, scope })
  return { type: 'close', ballot, counted, signature: sign(text, keyPair) }
}

// A person is { name, store, voter }, voter being their ed25519 key pair. The first one creates the
// room; the others join it by its key.
async function createRoom(people, options = {}) {
  let bootstrap = null
  for (const person of people) {
    person.base = new Autobase(person.store, bootstrap, {
      ...options,
      open,
      apply,
      valueEncoding: 'json'
    })
    await person.base.ready()
    bootstrap = person.base.key
  }
  return {
    people,
    async close() {
      for (const person of people) await person.base.close()
    }
  }
}

function admit(owner, person) {
  return owner.base.append({
    type: 'member',
    writer: hex(person.base.local.key),
    voter: hex(person.voter.publicKey),
    name: person.name
  })
}

function openBallot(person, ballot) {
  return person.base.append({ type: 'ballot', ...ballot })
}

async function vote(person, id, choices) {
  const { base, voter } = person
  const n = ballots.nextN(await votesOf(base.view, id), hex(voter.publicKey))
  await base.append(voteRecord(voter, hex(base.key), { ballot: id, n, choices }))
  return n
}

async function close(person, id) {
  const { base, voter } = person
  const counted = ballots.cutOf(await votesOf(base.view, id))
  await base.append(closeRecord(voter, hex(base.key), { ballot: id, counted }))
  return counted
}

// The run

const LUNCH = {
  id: 'lunch',
  question: 'Where do we eat on Friday?',
  options: ['Pizza', 'Sushi', 'Tacos'],
  mode: 'single'
}

async function main(log = console.log) {
  const removals = []
  const people = []
  for (const name of ['ana', 'bruno', 'cris']) {
    // test-tmp makes a temp dir in Node and Bare alike, and hands back what removes it
    const dir = await tmp({ teardown: (remove) => removals.push(remove) })
    people.push({ name, store: new Corestore(dir), voter: crypto.keyPair() })
  }

  const room = await createRoom(people)
  const [ana, bruno, cris] = room.people
  const names = new Map(people.map((p) => [hex(p.voter.publicKey), p.name]))
  const namesOf = (voters) => voters.map((voter) => names.get(voter)).sort()
  const sync = () => replicateAndSync(people.map((p) => p.base))
  const everyPeer = async () => {
    const results = []
    for (const person of people) results.push(await resultOf(person.base.view, 'lunch'))
    return results
  }
  const storedEverywhere = async (person, n) => {
    const voter = hex(person.voter.publicKey)
    const results = await everyPeer()
    return results.every((r) => r.stored.some((v) => v.voter === voter && v.n === n))
  }
  const show = ({ ballot, tally }) => {
    ballot.options.forEach((option, i) => {
      const who = namesOf(tally.voters[i]).join(', ')
      log(`  ${option.padEnd(6)} ${tally.counts[i]}  ${who}`.trimEnd())
    })
  }

  try {
    for (const person of people) await admit(ana, person)
    await openBallot(ana, LUNCH)
    await sync()
    log(`ana opens "${LUNCH.id}": ${LUNCH.question} ${LUNCH.options.join(', ')}`)

    await vote(ana, 'lunch', [0])
    await vote(bruno, 'lunch', [2])
    await vote(cris, 'lunch', [1])
    await sync()
    log('\nana votes Pizza, bruno Tacos, cris Sushi')
    show(await resultOf(ana.base.view, 'lunch'))

    const n = await vote(bruno, 'lunch', [1])
    await sync()
    log(`\nbruno changes his vote to Sushi (n = ${n})`)
    show(await resultOf(cris.base.view, 'lunch'))

    const forged = { ballot: 'lunch', voter: hex(ana.voter.publicKey), n: 2, choices: [2] }
    await cris.base.append(voteRecord(cris.voter, hex(cris.base.key), forged))
    await sync()
    log("\ncris's device appends a vote for Tacos in ana's name, signed with cris's key")
    log(`  ${(await storedEverywhere(ana, 2)) ? 'stored' : 'refused: no peer stores it'}`)
    show(await resultOf(bruno.base.view, 'lunch'))

    const cut = await close(ana, 'lunch')
    await sync()
    const listed = cut.map(([voter, n]) => `${names.get(voter)} ${n}`).sort()
    log(`\nana closes the ballot, counting ${listed.join(', ')}`)

    const late = await vote(cris, 'lunch', [2])
    await sync()
    const results = await everyPeer()
    const stored = (await storedEverywhere(cris, late)) ? 'stored' : 'not stored'
    const crisKey = hex(cris.voter.publicKey)
    const counted = results.some((r) =>
      r.tally.votes.some((v) => v.voter === crisKey && v.n === late)
    )
    log(`\ncris votes Tacos after the close (n = ${late})`)
    log(`  ${stored}, ${counted ? 'counted' : 'not counted'}`)

    const same = results.every((r) => JSON.stringify(r) === JSON.stringify(results[0]))
    const missing = namesOf(ballots.missing([...names.keys()], results[0].tally.votes))
    log(`\nfinal tally, ${same ? 'the same on all three peers' : 'NOT the same on every peer'}`)
    show(results[0])
    log(`  voted ${results[0].tally.voted} of 3, missing: ${missing.join(', ') || 'none'}`)
    return results
  } finally {
    await room.close()
    for (const remove of removals) await remove()
  }
}

function definitionOf({ options, mode, levels }) {
  return ballots.define({ options: options.length, mode, levels })
}

function voteKey(id, voter, n) {
  return `votes/${id}/${voter}/${n}`
}

function sign(text, keyPair) {
  return hex(crypto.sign(b4a.from(text), keyPair.secretKey))
}

function verify(text, signature, publicKey) {
  return crypto.verify(b4a.from(text), b4a.from(signature, 'hex'), b4a.from(publicKey, 'hex'))
}

function hex(buf) {
  return b4a.toString(buf, 'hex')
}

function isId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,64}$/.test(id)
}

function isKey(key) {
  return typeof key === 'string' && /^[0-9a-f]{64}$/.test(key)
}

function isSignature(signature) {
  return typeof signature === 'string' && /^[0-9a-f]{128}$/.test(signature)
}

function isText(text) {
  return typeof text === 'string' && text.length > 0 && text.length <= 200
}

module.exports = {
  LUNCH,
  open,
  apply,
  votesOf,
  resultOf,
  voteRecord,
  closeRecord,
  createRoom,
  admit,
  openBallot,
  vote,
  close,
  main
}

if (require.main === module) main()
