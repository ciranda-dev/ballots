const test = require('brittle')
const Corestore = require('corestore')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const tmp = require('test-tmp')
const { replicateAndSync } = require('autobase-test-helpers')
const ballots = require('..')
const example = require('../examples/autobase.js')

const { LUNCH, voteRecord, closeRecord, resultOf, vote, close } = example

test('the example: a changed vote, a forged vote, a close and a late vote', async (t) => {
  const lines = []
  const results = await example.main((line) => lines.push(line))
  const output = lines.join('\n')
  t.ok(output.includes('refused: no peer stores it'))
  t.ok(output.includes('stored, not counted'))
  t.ok(output.includes('the same on all three peers'))
  for (const result of results) {
    t.alike(result.tally.counts, [1, 2, 0])
    t.is(result.tally.voted, 3)
    t.is(result.stored.length, 5, 'ana 1, bruno 1 and 2, cris 1 and 2, and not the forged one')
  }
})

test('the same result whatever order the writers replicate in', { timeout: 120_000 }, async (t) => {
  // a is ana, b bruno, c cris: 'ab bc' syncs ana with bruno, then bruno with cris
  const orders = ['abc', 'ab bc ac', 'cb ac', 'bc ab']
  const outcomes = []
  for (const order of orders) {
    const { people, sync, scope } = await room(t, 'orders')
    const [ana, bruno, cris] = people
    const merge = async () => {
      for (const group of order.split(' ')) await sync(group)
      await sync()
    }

    // Each writes without seeing the others: votes, a changed vote and a forged one
    await vote(ana, 'lunch', [0])
    await vote(bruno, 'lunch', [2])
    await vote(bruno, 'lunch', [1])
    await vote(cris, 'lunch', [1])
    const forged = { ballot: 'lunch', voter: key(ana), n: 1, choices: [2] }
    await cris.base.append(voteRecord(cris.voter, scope, forged))
    await merge()

    // Then at once: ana's close, a late vote, and a second close ana signed that bruno relays
    const counted = await close(ana, 'lunch')
    await vote(cris, 'lunch', [2])
    const relayed = [[key(ana), 1]]
    await bruno.base.append(closeRecord(ana.voter, scope, { ballot: 'lunch', counted: relayed }))
    await merge()

    const results = await everyPeer(people)
    t.alike(results[1], results[0], `${order}: bruno has what ana has`)
    t.alike(results[2], results[0], `${order}: cris has what ana has`)
    const { close: kept, tally, stored } = results[0]
    t.is(stored.length, 5, 'the forged vote is stored nowhere, the late one everywhere')
    // Which of the two closes comes first is Autobase's order, the same on every peer
    if (kept.length === 1) {
      t.alike(kept, relayed)
      t.alike(tally.counts, [1, 0, 0], 'only what the relayed close lists')
    } else {
      t.alike(kept, counted)
      t.alike(tally.counts, [1, 2, 0], 'the late vote never counts')
    }
    outcomes.push(results[0])
  }
  for (let i = 1; i < orders.length; i++) {
    t.alike(outcomes[i], outcomes[0], `${orders[i]}: the same as ${orders[0]}`)
  }
})

test('the first valid close stands', async (t) => {
  const { people, sync, scope } = await room(t, 'closes')
  const [ana, bruno, cris] = people
  await vote(ana, 'lunch', [0])
  await vote(bruno, 'lunch', [2])
  await sync()

  const lunch = (counted) => ({ ballot: 'lunch', counted })
  const both = ballots.cutOf(await example.votesOf(ana.base.view, 'lunch'))
  await bruno.base.append(closeRecord(bruno.voter, scope, lunch(both)))
  await ana.base.append(closeRecord(ana.voter, scope, lunch([[key(cris), 1]])))
  await ana.base.append(closeRecord(ana.voter, 'another-room', lunch(both)))
  await ana.base.append(closeRecord(ana.voter, scope, lunch([...both].reverse())))
  await ana.base.append(closeRecord(ana.voter, scope, { ballot: 'dinner', counted: [] }))
  await ana.base.append({ ...closeRecord(ana.voter, scope, lunch(both)), ballot: 'Lunch!' })
  await ana.base.append({ ...closeRecord(ana.voter, scope, lunch(both)), signature: 'f00' })
  await sync()
  t.is((await resultOf(cris.base.view, 'lunch')).close, null, 'none of these closes stands')

  const first = await close(ana, 'lunch')
  await ana.base.append(closeRecord(ana.voter, scope, lunch([])))
  await sync()
  for (const result of await everyPeer(people)) {
    t.alike(result.close, first)
    t.alike(result.tally.counts, [1, 0, 1])
  }
})

test('two versions with the same n: the smaller tie, until the ballot closes', async (t) => {
  const { people, sync, scope } = await room(t, 'ties')
  const [ana, bruno, cris] = people
  // cris votes from two devices with the same n: both are signed with cris's key
  const twin = (choices) => voteRecord(cris.voter, scope, { ballot: 'lunch', n: 1, choices })
  const choiceOfCris = async (person) => {
    const { stored } = await resultOf(person.base.view, 'lunch')
    return stored.find((v) => v.voter === key(cris)).choices
  }

  await cris.base.append(twin([2]))
  await bruno.base.append(twin([1]))
  await sync()
  t.alike(await choiceOfCris(ana), [1], 'the smaller tie is kept')
  await bruno.base.append(twin([2]))
  await sync()
  t.alike(await choiceOfCris(ana), [1], 'a copy written again changes nothing')

  await close(ana, 'lunch')
  await bruno.base.append(twin([0]))
  await sync()
  for (const person of people) {
    t.alike(await choiceOfCris(person), [1], 'a smaller tie after the close changes nothing')
  }
  t.alike((await resultOf(ana.base.view, 'lunch')).tally.counts, [0, 1, 0])
})

test('records that break the rules change nothing', async (t) => {
  const { people, sync, scope } = await room(t, 'rules')
  const [ana, bruno] = people
  await vote(ana, 'lunch', [0])
  await sync()
  const before = await everyPeer(people)

  const eve = crypto.keyPair()
  const lunch = { ballot: 'lunch', n: 1, choices: [1] }
  const sneaky = { type: 'member', writer: key(eve), voter: key(eve), name: 'eve' }
  await bruno.base.append(sneaky)
  await ana.base.append({ ...sneaky, writer: 'not a key' })
  await ana.base.append(voteRecord(eve, scope, lunch))
  await ana.base.append(voteRecord(bruno.voter, 'another-room', lunch))
  await ana.base.append(voteRecord(bruno.voter, scope, { ...lunch, choices: [3] }))
  await ana.base.append(voteRecord(bruno.voter, scope, { ...lunch, n: 0 }))
  await ana.base.append({ ...voteRecord(bruno.voter, scope, lunch), voter: 'bruno' })
  await ana.base.append({ ...voteRecord(bruno.voter, scope, lunch), signature: null })
  await ana.base.append({ ...voteRecord(bruno.voter, scope, lunch), ballot: 'Lunch!' })
  await ana.base.append({ ...voteRecord(bruno.voter, scope, lunch), ballot: 'dinner' })
  await ana.base.append({ ...LUNCH, type: 'ballot', question: 'Somewhere else?' })
  await ana.base.append({ ...LUNCH, type: 'ballot', id: 'one', options: ['Pizza'] })
  await ana.base.append({ ...LUNCH, type: 'ballot', id: 'two', options: 'Pizza, Sushi' })
  await ana.base.append({ ...LUNCH, type: 'ballot', id: 'three', question: '' })
  await ana.base.append({ type: 'nothing' })
  await ana.base.append('a string')
  await ana.base.append(7)
  await sync()

  t.alike(await everyPeer(people), before)
  t.is(await ana.base.view.get('members/' + key(eve)), null, 'only the owner admits members')
  for (const id of ['one', 'two', 'three']) t.is(await ana.base.view.get('ballots/' + id), null)
})

test('a ballot on a scale', async (t) => {
  const { people, sync } = await room(t, 'scale')
  const [ana, bruno, cris] = people
  const slots = { id: 'slots', question: 'Which day works?', options: ['Mon', 'Tue'] }
  await example.openBallot(bruno, { ...slots, mode: 'scale', levels: 3 })
  await sync()
  await vote(ana, 'slots', [2, 0])
  await vote(cris, 'slots', [2, 1])
  await sync()
  const result = await resultOf(ana.base.view, 'slots')
  t.alike(result.tally.counts, [
    [0, 0, 2],
    [1, 1, 0]
  ])
  t.is(result.ballot.by, key(bruno), 'bruno opened it, so bruno may close it')
})

// Three people in a room with a lunch ballot. The keys come from `seed`, so every run builds the
// same log.
async function room(t, seed) {
  const people = []
  for (const name of ['ana', 'bruno', 'cris']) {
    const at = (kind) => crypto.hash(b4a.from(`${seed}/${name}/${kind}`))
    const store = new Corestore(await tmp(t), { primaryKey: at('store'), unsafe: true })
    people.push({ name, store, voter: crypto.keyPair(at('voter')) })
  }
  const shared = await example.createRoom(people, { ackInterval: 0 })
  t.teardown(() => shared.close())

  // sync('ab') replicates ana's and bruno's bases until they agree
  const sync = (group = 'abc') =>
    replicateAndSync([...group].map((c) => people['abc'.indexOf(c)].base))
  for (const person of people) await example.admit(people[0], person)
  await example.openBallot(people[0], LUNCH)
  await sync()
  return { people, sync, scope: b4a.toString(people[0].base.key, 'hex') }
}

async function everyPeer(people) {
  const results = []
  for (const person of people) results.push(await resultOf(person.base.view, 'lunch'))
  return results
}

function key(person) {
  return b4a.toString((person.voter || person).publicKey, 'hex')
}
