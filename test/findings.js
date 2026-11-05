// The inputs of an adversarial review, one test per finding. Each one used to work and must not.
const test = require('brittle')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const ballots = require('..')

const lunch = ballots.define({ options: 3 })
const multiple = ballots.define({ options: 4, mode: 'multiple' })
const scale = ballots.define({ options: 2, mode: 'scale', levels: 3 })

// A vote as a host builds it: signed by its voter, the tie a hash of the signed text.
function signed(voter, n, choices, { ballot = 'poll/1', scope = 'room', extra = [] } = {}) {
  const record = { ballot, voter: hex(voter.publicKey), n, choices }
  const text = ballots.signable(record, { scope, extra })
  record.signature = hex(crypto.sign(b4a.from(text), voter.secretKey))
  record.tie = hex(crypto.hash(b4a.from(text)))
  return record
}

const people = {}
for (const name of ['ana', 'bruno', 'cris', 'eve']) {
  people[name] = crypto.keyPair(crypto.hash(b4a.from('findings/' + name)))
}
const { ana, bruno } = people

test('F1 a version signed after the close never counts, whatever its tie', (t) => {
  const before = [signed(ana, 1, [2]), signed(bruno, 1, [1])]
  const close = { counted: ballots.cutOf(lunch, before) }
  const fixed = ballots.tally(lunch, before, close)
  t.alike(fixed.counts, [0, 1, 1])
  for (const extra of [['0'], ['1'], ['phone'], ['laptop'], ['']]) {
    for (const choices of [[0], [1], [2], []]) {
      const late = signed(ana, 1, choices, { extra })
      t.alike(ballots.tally(lunch, [late, ...before], close), fixed)
      t.alike(ballots.tally(lunch, [...before, late], close), fixed)
    }
  }
})

test('F1 two devices at once: every peer counts what the closer closed', (t) => {
  const phone = signed(ana, 1, [2], { extra: ['phone'] })
  const laptop = signed(ana, 1, [0], { extra: ['laptop'] })
  const close = { counted: ballots.cutOf(lunch, [phone]) }
  t.alike(ballots.tally(lunch, [phone], close).counts, [0, 0, 1])
  t.alike(ballots.tally(lunch, [phone, laptop], close).counts, [0, 0, 1])
  t.alike(ballots.tally(lunch, [laptop, phone], close).counts, [0, 0, 1])
})

test('F2 a vote needs a string tie, and equal ties never depend on order', (t) => {
  const pairs = [
    [
      { voter: 'a', n: 1, choices: [0] },
      { voter: 'a', n: 1, choices: [2] }
    ],
    [
      { voter: 'a', n: 1, choices: [0], tie: 5 },
      { voter: 'a', n: 1, choices: [2], tie: 'abc' }
    ],
    [
      { voter: 'a', n: 1, choices: [0], tie: NaN },
      { voter: 'a', n: 1, choices: [2], tie: NaN }
    ],
    [
      { voter: 'a', n: 1, choices: [0], tie: {} },
      { voter: 'a', n: 1, choices: [2], tie: {} }
    ],
    [
      { voter: 'a', n: 1, choices: [0], tie: b4a.from([0xff, 0x41]) },
      { voter: 'a', n: 1, choices: [2], tie: b4a.from([0xfe, 0x41]) }
    ]
  ]
  for (const [a, b] of pairs) {
    t.absent(ballots.isVote(lunch, a), 'not a vote')
    t.alike(ballots.tally(lunch, [a, b]), ballots.tally(lunch, [b, a]))
  }
  const a = { voter: 'a', n: 1, choices: [0], tie: 'x' }
  const b = { voter: 'a', n: 1, choices: [2], tie: 'x' }
  t.is(ballots.prefer(a, b), a)
  t.is(ballots.prefer(b, a), a, 'the same answer both ways')
  t.alike(ballots.tally(lunch, [a, b]), ballots.tally(lunch, [b, a]))
  const close = { counted: [['a', 1, 'x']] }
  t.alike(ballots.tally(lunch, [a, b], close), ballots.tally(lunch, [b, a], close))
})

test('F3 cutOf and nextN look only at valid votes', (t) => {
  const v = (voter, n, choices) => ({ voter, n, choices, tie: voter + n })
  const votes = [v('ana', 1, [0]), v('ana', 2, [9]), v('bruno', 1, [1])]
  const close = { counted: ballots.cutOf(lunch, votes) }
  t.ok(ballots.isCut(lunch, close.counted))
  t.alike(ballots.tally(lunch, votes, close).counts, ballots.tally(lunch, votes).counts)

  const stray = [v('ana', 1, [0]), v('bruno', 1, [1]), v('eve', 5000, [2])]
  t.ok(ballots.isCut(lunch, ballots.cutOf(lunch, stray)), 'one bad record never blocks a close')

  const n = ballots.nextN(lunch, [v('ana', 1, [0]), v('ana', 2000, [1])], 'ana')
  t.is(n, 2)
  t.ok(ballots.isVote(lunch, v('ana', n, [2])), 'and never locks a voter out')
})

test('F5 a close listing a version nobody wrote counts nothing for it', (t) => {
  const close = { counted: [['e', 1, 'nobody-signed-this']] }
  t.ok(ballots.isCut(lunch, close.counted))
  const later = [{ voter: 'e', n: 1, choices: [1], tie: 'e-1' }]
  const result = ballots.tally(lunch, later, close)
  t.is(result.voted, 0)
  t.alike(ballots.missing(['e'], result.votes), ['e'], 'missing counts what matched')
})

test('F6 nothing in apply throws, whatever it is given', (t) => {
  const throwing = new Proxy(
    {},
    {
      get() {
        throw new Error('trap')
      },
      has() {
        throw new Error('trap')
      }
    }
  )
  const revoked = Proxy.revocable([], {})
  revoked.revoke()
  const getter = (field) => ({
    voter: 'a',
    n: 1,
    choices: [0],
    tie: 't',
    get [field]() {
      throw new Error('getter')
    }
  })
  const junk = [
    undefined,
    null,
    0,
    'x',
    [],
    {},
    [null],
    [[]],
    throwing,
    revoked.proxy,
    getter('voter'),
    getter('choices'),
    getter('tie'),
    { voter: 'a', n: 1, choices: throwing, tie: 't' },
    { voter: 'a', n: 1, choices: revoked.proxy, tie: 't' },
    { counted: throwing },
    { counted: [throwing] }
  ]
  const run = (fn) => {
    try {
      fn()
      return true
    } catch {
      return false
    }
  }
  let calls = 0
  for (const ballot of [lunch, scale, ...junk]) {
    for (const x of junk) {
      for (const y of junk) {
        const ok =
          run(() => ballots.define(x, y)) &&
          run(() => ballots.isChoices(ballot, x)) &&
          run(() => ballots.isVote(ballot, x)) &&
          run(() => ballots.isCut(ballot, x)) &&
          run(() => ballots.prefer(x, y)) &&
          run(() => ballots.cutOf(ballot, [x, y])) &&
          run(() => ballots.cutOf(ballot, x)) &&
          run(() => ballots.nextN(ballot, [x, y], 'a')) &&
          run(() => ballots.nextN(ballot, x, y)) &&
          run(() => ballots.counted(ballot, [x], y)) &&
          run(() => ballots.counted(ballot, x, y)) &&
          run(() => ballots.tally(ballot, [x, y], y)) &&
          run(() => ballots.tally(ballot, x, y)) &&
          run(() => ballots.missing(x, y)) &&
          run(() => ballots.missing([x], [y]))
        if (!ok) t.fail('threw on ' + calls)
        calls++
      }
    }
  }
  t.pass(calls + ' combinations, none threw')
  t.alike(ballots.tally(null, []), { counts: [], voters: [], voted: 0, votes: [] })
})

test('F6 a list that throws midway still counts the items it can read', (t) => {
  const votes = [{ voter: 'a', n: 1, choices: [0], tie: 'a' }]
  Object.defineProperty(votes, 1, {
    get() {
      throw new Error('getter')
    }
  })
  votes.push({ voter: 'b', n: 1, choices: [1], tie: 'b' })
  t.alike(ballots.tally(lunch, votes).counts, [1, 1, 0])
})

test('F7 a ballot that define would refuse counts nothing', (t) => {
  const vote = (choices) => ({ voter: 'a', n: 1, choices, tie: 'a' })
  const stored = { options: 3, mode: 'single', levels: 0, maxVersions: 1000, maxVoters: 4096 }
  const plain = { ...stored, maxTie: 128 }
  t.ok(ballots.isVote(plain, vote([0])), 'a plain copy of a definition works')
  t.alike(ballots.tally(plain, [vote([2])]).counts, [0, 0, 1])
  const rating = { ...plain, mode: 'scale', levels: 2 }
  t.alike(ballots.tally(rating, [vote([1, 0, 1])]).counts, [
    [0, 1],
    [1, 0],
    [0, 1]
  ])
  const refused = [
    { ...plain, mode: 'ranked' },
    { ...plain, options: 2.5 },
    { ...plain, options: 1e6, mode: 'scale', levels: 16 },
    { ...plain, levels: 2 },
    { ...plain, mode: 'scale', levels: 300 },
    { ...plain, maxVersions: undefined },
    { ...plain, maxVoters: Infinity },
    { ...plain, maxTie: 0 },
    stored
  ]
  for (const ballot of refused) {
    t.absent(ballots.isVote(ballot, vote([0])))
    t.absent(ballots.isCut(ballot, []))
    t.alike(ballots.tally(ballot, [vote([2])]).counts, [])
  }
  t.is(ballots.define({ options: 3 }, { maxVersions: undefined }), null)
  t.is(ballots.define({ options: 3 }, { maxVoters: Infinity }), null)
  t.is(ballots.define({ options: 3 }, { maxVersions: -5 }), null)
  t.is(ballots.define({ options: 1e7 }, { maxOptions: Infinity }), null)
  t.is(ballots.define(new Proxy({}, { get: () => 3 })), null, 'a proxy is not a mode')
  t.is(
    ballots.define({
      get options() {
        throw new Error('getter')
      }
    }),
    null
  )
})

test('F7 the constants cannot be changed', (t) => {
  t.exception.all(() => {
    'use strict'
    ballots.MODES.push('ranked')
  })
  t.exception.all(() => {
    'use strict'
    ballots.LIMITS.maxVersions = 3
  })
  t.is(ballots.define({ options: 3, mode: 'ranked' }), null)
  t.is(ballots.define({ options: 3 }).maxVersions, 1000)
})

test('F8 a closed tally reads each cut entry once', (t) => {
  const votes = []
  const counted = []
  for (let i = 0; i < 4096; i++) {
    const voter = 'v' + String(i).padStart(5, '0')
    for (let n = 1; n <= 20; n++) votes.push({ voter, n, choices: [n % 3], tie: voter + n })
    counted.push([voter, 20, voter + 20])
  }
  let reads = 0
  const cut = new Proxy(counted, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      return target[key]
    }
  })
  const result = ballots.tally(lunch, votes, { counted: cut })
  t.is(result.voted, 4096)
  t.is(reads, 4096, 'one read per entry, whatever the number of votes')
})

test('F9 the voter is signed: a copy under another spelling of the key fails', (t) => {
  const vote = signed(ana, 1, [1], { scope: 'room-1' })
  const check = (record) =>
    crypto.verify(
      b4a.from(ballots.signable(record, { scope: 'room-1' })),
      b4a.from(record.signature, 'hex'),
      b4a.from(hex(ana.publicKey), 'hex')
    )
  t.ok(check(vote))
  for (const voter of [vote.voter.toUpperCase(), vote.voter + 'zz', hex(bruno.publicKey)]) {
    t.absent(check({ ...vote, voter }), 'refused: ' + voter.slice(0, 8) + '…' + voter.slice(-4))
  }
})

test('F10 the signed text has one reading', (t) => {
  const vote = { ballot: 'p', voter: 'v', n: 1, choices: [0] }
  t.exception(() => ballots.signable({ ...vote, ballot: 'poll\ud800' }), 'a lone surrogate')
  t.exception(() => ballots.signable(vote, { scope: 'room\ude00' }))
  t.exception(() => ballots.signable(vote, { domain: 'a\udbff' }))
  t.exception(() => ballots.signable(vote, { extra: ['\ud83d'] }))
  t.exception(() => ballots.signableClose({ ballot: 'p\ud800', counted: [] }))
  t.exception(() => ballots.signable(vote, { extra: [NaN] }))
  t.exception(() => ballots.signable(vote, { extra: [1e21] }))
  t.exception(() => ballots.signable(vote, { extra: [Infinity] }))
  t.exception(() => ballots.signable(vote, { extra: 'ab' }))
  t.exception(() => ballots.signable({ ...vote, choices: new Array(1) }), 'a hole')
  t.exception(() => ballots.signable({ ...vote, n: 0 }))
  t.is(ballots.signable(vote, { extra: [-0] }), ballots.signable(vote, { extra: [0] }))

  // brute force over small fields that hold the separators and edge characters
  const atoms = ['', ',', '0', '1', '01', '\r', ' ', '[', ']', '"', 'a', '0,1']
  const seen = new Map()
  for (const ballot of atoms) {
    for (const voter of ['', 'a', ',']) {
      for (const n of [1, 10]) {
        for (const extra of [[], ...atoms.map((x) => [x]), ['', ''], ['0', '1']]) {
          for (const choices of [[], [0], [1], [0, 1], [10], [1, 0]]) {
            const text = ballots.signable({ ballot, voter, n, choices }, { extra })
            const key = JSON.stringify([ballot, voter, n, extra, choices])
            if (seen.has(text) && seen.get(text) !== key) t.fail(seen.get(text) + ' / ' + key)
            seen.set(text, key)
          }
        }
      }
    }
  }
  t.pass(seen.size + ' vote texts, all distinct')
})

test('F12 holes are refused, and a long sparse array costs nothing', (t) => {
  t.absent(ballots.isChoices(lunch, new Array(1)))
  t.absent(ballots.isChoices(scale, new Array(2)))
  t.absent(ballots.isChoices(multiple, [0, ,])) // eslint-disable-line no-sparse-arrays
  t.is(ballots.tally(lunch, [{ voter: 'a', n: 1, choices: new Array(1), tie: 'a' }]).voted, 0)
  t.absent(ballots.isCut(lunch, [['a', 1, 't'], , ['c', 1, 't']])) // eslint-disable-line no-sparse-arrays
  t.absent(ballots.isCut(lunch, [['a', 1, 't'], ,])) // eslint-disable-line no-sparse-arrays

  const sparse = new Array(1e7)
  sparse[0] = 0
  t.absent(ballots.isChoices(multiple, sparse))
  t.exception(() => ballots.signable({ ballot: 'p', voter: 'v', n: 1, choices: sparse }))
})

test('F12 each field is read once: a getter cannot change what was checked', (t) => {
  let reads = 0
  const vote = {
    voter: 'a',
    n: 1,
    tie: 'a',
    get choices() {
      return reads++ === 0 ? [0] : [2]
    }
  }
  t.alike(ballots.tally(lunch, [vote]).counts, [1, 0, 0], 'what was checked is what counts')
  let again = 0
  const bad = {
    voter: 'a',
    n: 1,
    tie: 'a',
    get choices() {
      return again++ === 0 ? [0] : [50]
    }
  }
  t.alike(ballots.tally(lunch, [bad]).counts, [1, 0, 0])
})

test('F15 at maxVersions a voter can not change their vote', (t) => {
  const stuck = [{ voter: 'ana', n: 1000, choices: [0], tie: 'x' }]
  t.is(ballots.nextN(lunch, stuck, 'ana'), null)
  const small = ballots.define({ options: 3 }, { maxVoters: 2 })
  const three = ['a', 'b', 'c'].map((voter) => ({ voter, n: 1, choices: [0], tie: voter }))
  t.is(ballots.tally(small, three).voted, 3, 'open, every voter counts')
  t.absent(ballots.isCut(small, ballots.cutOf(small, three)), 'no close can list them all')
})

test('holds: the same records in any order give the same tally', (t) => {
  const VOTERS = ['__proto__', 'constructor', 'hasOwnProperty', '', 'ana', 'Ana', 'é', 'é', '😀']
  let checks = 0
  for (const ballot of [lunch, multiple, scale]) {
    for (let round = 0; round < 50; round++) {
      const random = prng(round + 1)
      const records = []
      for (let i = 0; i < 25; i++) {
        const voter = VOTERS[Math.floor(random() * VOTERS.length)]
        const n = 1 + Math.floor(random() * 4)
        const choices = randomChoices(ballot, random)
        records.push({ voter, n, choices, tie: n + ':' + JSON.stringify(choices) })
      }
      records.push(records[0], { ...records[1] })
      const close = { counted: ballots.cutOf(ballot, records.slice(0, 12)) }
      const want = JSON.stringify([
        ballots.tally(ballot, records),
        ballots.tally(ballot, records, close)
      ])
      for (let k = 0; k < 10; k++) {
        const order = [...records].sort(() => random() - 0.5)
        const got = JSON.stringify([
          ballots.tally(ballot, order),
          ballots.tally(ballot, order, close)
        ])
        if (got !== want) t.fail('order changed the tally')
        checks++
      }
    }
  }
  t.pass(checks + ' shuffled tallies equal')
  t.is({}.voter, undefined, 'no prototype touched')
})

test('holds: no clock is read', (t) => {
  const now = Date.now
  const DateCtor = globalThis.Date
  Date.now = () => {
    throw new Error('clock read')
  }
  globalThis.Date = function () {
    throw new Error('clock read')
  }
  try {
    const votes = [signed(ana, 1, [0]), signed(bruno, 2, [1])]
    ballots.tally(lunch, votes, { counted: ballots.cutOf(lunch, votes) })
    ballots.missing(['a', 'c'], votes)
    ballots.nextN(lunch, votes, 'a')
    t.pass('ran with Date poisoned')
  } finally {
    globalThis.Date = DateCtor
    Date.now = now
  }
})

function randomChoices(ballot, random) {
  if (random() < 0.15) return []
  if (random() < 0.1) return [Math.floor(random() * 10)]
  if (ballot.mode === 'single') return [Math.floor(random() * ballot.options)]
  if (ballot.mode === 'scale') {
    return Array.from({ length: ballot.options }, () => Math.floor(random() * ballot.levels))
  }
  return [...Array(ballot.options).keys()].filter(() => random() < 0.5)
}

function prng(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
}

function hex(buf) {
  return b4a.toString(buf, 'hex')
}
