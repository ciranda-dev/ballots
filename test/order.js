const test = require('brittle')
const ballots = require('..')

// Each case comes from its seed, so a failure names the seed that reproduces it.
const SEED = 20261106
const CASES = 200
const VOTERS = ['ana', 'bruno', 'cris', 'dani', 'edu']
const JUNK = [[99], [1, 0], [0, 0], [-1], [0.5], '0', null, [[0]]]

test('the same records in any order give the same counted votes and tally', (t) => {
  for (let seed = SEED; seed < SEED + CASES; seed++) {
    const random = prng(seed)
    const { ballot, records, close } = generate(random)
    const expected = outcome(ballot, records, close)
    let actual = expected
    for (const order of orders(records, random)) {
      actual = outcome(ballot, order, close)
      if (JSON.stringify(actual) !== JSON.stringify(expected)) break
    }
    const kind = `${ballot.mode}, ${records.length} records, ${close ? 'closed' : 'open'}`
    t.alike(actual, expected, `seed ${seed}: ${kind}`)
  }
})

test('once closed, votes the close does not list change nothing, wherever they land', (t) => {
  for (let seed = SEED; seed < SEED + CASES; seed++) {
    const random = prng(seed)
    const { ballot, voters, records } = generate(random)
    const close = randomClose(random, ballot, voters, records)
    const late = []
    for (let i = int(random, 1, 4); i > 0; i--) {
      const vote = randomVote(random, ballot, voters)
      const listed = close.counted.some(([voter, n]) => voter === vote.voter && n === vote.n)
      if (!listed) late.push(vote)
    }
    const actual = outcome(ballot, shuffle([...records, ...late], random), close)
    t.alike(actual, outcome(ballot, records, close), `seed ${seed}: ${late.length} late`)
  }
})

function outcome(ballot, records, close) {
  return {
    counted: ballots.counted(ballot, records, close),
    tally: ballots.tally(ballot, records, close)
  }
}

function generate(random) {
  const mode = pick(random, ballots.MODES)
  const levels = mode === 'scale' ? int(random, 2, 4) : 0
  const ballot = ballots.define({ options: int(random, 2, 5), mode, levels }, { maxVersions: 4 })
  const voters = VOTERS.slice(0, int(random, 1, VOTERS.length))
  const records = []
  for (let count = int(random, 1, 12); records.length < count;) {
    // a copy of a record already there, as anyone may write one again
    if (records.length > 0 && random() < 0.15) records.push({ ...pick(random, records) })
    else records.push(randomVote(random, ballot, voters))
  }
  const close = random() < 0.25 ? null : randomClose(random, ballot, voters, records)
  return { ballot, voters, records, close }
}

function randomVote(random, ballot, voters) {
  const voter = random() < 0.05 ? 7 : pick(random, voters)
  const n = int(random, 0, ballot.maxVersions + 1)
  const choices = random() < 0.15 ? pick(random, JUNK) : randomChoices(random, ballot)
  // The tie stands for the signed bytes, so it follows from n and the choices: two versions with
  // the same voter and n differ in their tie exactly when they differ in their choices.
  return { voter, n, choices, tie: n + ':' + JSON.stringify(choices) }
}

function randomChoices(random, ballot) {
  if (random() < 0.1) return []
  if (ballot.mode === 'single') return [int(random, 0, ballot.options - 1)]
  if (ballot.mode === 'scale') {
    return Array.from({ length: ballot.options }, () => int(random, 0, ballot.levels - 1))
  }
  const choices = []
  for (let option = 0; option < ballot.options; option++) {
    if (random() < 0.5) choices.push(option)
  }
  return choices
}

// Half the time what a closer had seen (the newest of some valid records), half any list at all.
function randomClose(random, ballot, voters, records) {
  if (random() < 0.5) {
    const seen = shuffle(records, random).slice(0, int(random, 0, records.length))
    return { counted: ballots.cutOf(seen.filter((vote) => ballots.isVote(ballot, vote))) }
  }
  const listed = voters.filter(() => random() < 0.6)
  return { counted: listed.map((voter) => [voter, int(random, 1, ballot.maxVersions)]) }
}

// Every order of a few records, or many shuffles of more.
function* orders(records, random) {
  if (records.length <= 6) yield* permutations(records)
  else for (let i = 0; i < 300; i++) yield shuffle(records, random)
}

function* permutations(list) {
  if (list.length <= 1) {
    yield list
    return
  }
  for (let i = 0; i < list.length; i++) {
    const rest = [...list.slice(0, i), ...list.slice(i + 1)]
    for (const tail of permutations(rest)) yield [list[i], ...tail]
  }
}

function shuffle(list, random) {
  const order = [...list]
  for (let i = order.length - 1; i > 0; i--) {
    const j = int(random, 0, i)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

function pick(random, list) {
  return list[int(random, 0, list.length - 1)]
}

function int(random, min, max) {
  return min + Math.floor(random() * (max - min + 1))
}

// mulberry32: a small 32-bit generator, the same sequence for the same seed in Node and Bare
function prng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let x = state
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
