// Open, named ballots over a replicated append-only log (Autobase and the like). Pure functions:
// no I/O, no clock, no dependencies. The host checks signatures and membership and stores the
// records; this says what a record may be and what the records add up to.
//
// Everything that runs in apply reads each field once into a plain copy, checks the copy, and
// never throws, whatever it is given.

const MODES = Object.freeze(['single', 'multiple', 'scale'])

const LIMITS = Object.freeze({
  minOptions: 2,
  maxOptions: 64,
  maxLevels: 16,
  maxVersions: 1000,
  maxVoters: 4096,
  maxTie: 128
})

// What `limits` may be set to, and what any ballot is checked against.
const RANGES = {
  minOptions: [1, 256],
  maxOptions: [1, 256],
  maxLevels: [2, 256],
  maxVersions: [1, Number.MAX_SAFE_INTEGER],
  maxVoters: [1, 65536],
  maxTie: [1, 1024]
}

const defined = new WeakSet()

function define(spec, limits = {}) {
  try {
    const bounds = { ...LIMITS, ...limits }
    for (const name of Object.keys(RANGES)) {
      if (!within(bounds[name], ...RANGES[name])) return null
    }
    if (bounds.minOptions > bounds.maxOptions) return null
    if (spec === null || typeof spec !== 'object') return null
    const { options, mode = 'single', levels = 0 } = spec
    if (!MODES.includes(mode)) return null
    if (!within(options, bounds.minOptions, bounds.maxOptions)) return null
    if (mode === 'scale' ? !within(levels, 2, bounds.maxLevels) : levels !== 0) return null
    const { maxVersions, maxVoters, maxTie } = bounds
    const ballot = Object.freeze({ options, mode, levels, maxVersions, maxVoters, maxTie })
    defined.add(ballot)
    return ballot
  } catch {
    return null
  }
}

function isChoices(ballot, choices) {
  const b = shape(ballot)
  return b !== null && attempt(() => readChoices(b, choices)) !== null
}

function isVote(ballot, vote) {
  const b = shape(ballot)
  return b !== null && readVote(b, vote) !== null
}

function isCut(ballot, cut) {
  const b = shape(ballot)
  return b !== null && attempt(() => readCut(b, cut)) !== null
}

// Of two versions with the same voter and n, the one to keep: the smaller tie, then the smaller
// choices. One that isn't a version loses.
function prefer(a, b) {
  const x = attempt(() => readVersion(a))
  const y = attempt(() => readVersion(b))
  if (y === null) return a
  if (x === null) return b
  return wins(y, x) ? b : a
}

function cutOf(ballot, votes) {
  return counted(ballot, votes).map((vote) => [vote.voter, vote.n, vote.tie])
}

// The n for the voter's next vote, or null once they used up maxVersions.
function nextN(ballot, votes, voter) {
  const b = shape(ballot)
  if (b === null) return null
  let n = 0
  for (const vote of readVotes(b, votes)) if (vote.voter === voter && vote.n > n) n = vote.n
  return n < b.maxVersions ? n + 1 : null
}

function counted(ballot, votes, close = null) {
  const b = shape(ballot)
  if (b === null) return []
  const valid = readVotes(b, votes)
  if (close === null) return newest(valid)
  const cut = attempt(() => readCut(b, close.counted))
  if (cut === null) return []
  const at = new Map(cut.map(([voter, n, tie]) => [voter, { n, tie }]))
  return newest(
    valid.filter((vote) => {
      const entry = at.get(vote.voter)
      return entry !== undefined && entry.n === vote.n && entry.tie === vote.tie
    })
  )
}

function tally(ballot, votes, close = null) {
  const b = shape(ballot)
  const counts = []
  const voters = []
  if (b === null) return { counts, voters, voted: 0, votes: [] }
  const scale = b.mode === 'scale'
  for (let i = 0; i < b.options; i++) {
    counts.push(scale ? new Array(b.levels).fill(0) : 0)
    voters.push(scale ? Array.from({ length: b.levels }, () => []) : [])
  }
  const cast = counted(b, votes, close).filter((vote) => vote.choices.length > 0)
  for (const { voter, choices } of cast) {
    choices.forEach((choice, i) => {
      if (scale) {
        counts[i][choice]++
        voters[i][choice].push(voter)
      } else {
        counts[choice]++
        voters[choice].push(voter)
      }
    })
  }
  return { counts, voters, voted: cast.length, votes: cast }
}

function missing(eligible, cast) {
  const voted = new Set()
  each(cast, (vote) => {
    const voter = vote.voter
    if (typeof voter === 'string') voted.add(voter)
  })
  const out = new Set()
  each(eligible, (voter) => {
    if (typeof voter === 'string' && !voted.has(voter)) out.add(voter)
  })
  return [...out].sort()
}

// The exact text a voter signs, so every peer checks the same bytes. `scope` binds the vote to its
// place (a room, a group) so it can't be replayed elsewhere; `extra` holds the app's own fields.
// It runs when a vote is signed or checked, and throws on anything that isn't one.
function signable(vote, { domain = 'ballots/vote', scope = '', extra = [] } = {}) {
  if (vote === null || typeof vote !== 'object') throw new Error('not a vote')
  const { ballot, voter, n, choices } = vote
  const list = arrayOf(choices, RANGES.maxOptions[1])
  if (!isUint(n) || n < 1 || list === null || !list.every(isUint)) throw new Error('not a vote')
  return [
    ...[domain, scope, ballot, voter].map(line),
    String(n),
    ...fields(extra),
    list.join(',')
  ].join('\n')
}

// The same for a close: the counted list goes last, as JSON.
function signableClose(close, { domain = 'ballots/close', scope = '', extra = [] } = {}) {
  if (close === null || typeof close !== 'object') throw new Error('not a close')
  const { ballot, counted } = close
  const cut = arrayOf(counted, RANGES.maxVoters[1])
  const entries = cut && cut.map((entry) => arrayOf(entry, 3))
  const valid = (e) => e && e.length === 3 && typeof e[0] === 'string' && isN(e[1]) && isTie(e[2])
  if (!entries || !entries.every(valid)) throw new Error('not a close')
  return [...[domain, scope, ballot].map(line), ...fields(extra), JSON.stringify(entries)].join(
    '\n'
  )
}

// Reading records

function shape(ballot) {
  if (defined.has(ballot)) return ballot
  return attempt(() => {
    if (ballot === null || typeof ballot !== 'object') return null
    const { options, mode, levels, maxVersions, maxVoters, maxTie } = ballot
    const b = { options, mode, levels, maxVersions, maxVoters, maxTie }
    if (!MODES.includes(mode) || !within(options, 1, RANGES.maxOptions[1])) return null
    if (mode === 'scale' ? !within(levels, ...RANGES.maxLevels) : levels !== 0) return null
    if (!within(maxVersions, ...RANGES.maxVersions)) return null
    if (!within(maxVoters, ...RANGES.maxVoters) || !within(maxTie, ...RANGES.maxTie)) return null
    return b
  })
}

function readVote(b, vote) {
  return attempt(() => {
    if (vote === null || typeof vote !== 'object') return null
    const { voter, n, tie, choices } = vote
    if (typeof voter !== 'string' || !isN(n, b) || !isTie(tie, b)) return null
    const list = readChoices(b, choices)
    return list === null ? null : { voter, n, choices: list, tie }
  })
}

function readVotes(b, votes) {
  const valid = []
  each(votes, (vote) => {
    const read = readVote(b, vote)
    if (read !== null) valid.push(read)
  })
  return valid
}

function readChoices(b, value) {
  const choices = arrayOf(value, b.options)
  if (choices === null || choices.length === 0) return choices
  if (b.mode === 'scale') {
    const fits = choices.length === b.options && choices.every((c) => isUint(c) && c < b.levels)
    return fits ? choices : null
  }
  if (b.mode === 'single' && choices.length !== 1) return null
  // strictly increasing: in range, no duplicates, and only one way to write each set
  const fits = choices.every(
    (c, i) => isUint(c) && c < b.options && (i === 0 || c > choices[i - 1])
  )
  return fits ? choices : null
}

function readCut(b, value) {
  const cut = arrayOf(value, b.maxVoters)
  if (cut === null) return null
  const entries = []
  for (const item of cut) {
    const entry = arrayOf(item, 3)
    if (entry === null || entry.length !== 3) return null
    const [voter, n, tie] = entry
    if (typeof voter !== 'string' || !isN(n, b) || !isTie(tie, b)) return null
    if (entries.length > 0 && !(voter > entries[entries.length - 1][0])) return null
    entries.push(entry)
  }
  return entries
}

function readVersion(vote) {
  if (vote === null || typeof vote !== 'object') return null
  const { tie, choices } = vote
  const list = arrayOf(choices, RANGES.maxOptions[1])
  return typeof tie === 'string' && list !== null && list.every(isUint)
    ? { tie, choices: list }
    : null
}

// A dense copy of an array of at most `max` items, or null. Reads the length and each item once.
function arrayOf(value, max) {
  if (!Array.isArray(value)) return null
  const length = value.length
  if (!within(length, 0, max)) return null
  const copy = []
  for (let i = 0; i < length; i++) {
    if (!(i in value)) return null
    copy.push(value[i])
  }
  return copy
}

// Calls fn with each item of a list, skipping any item that can't be read.
function each(list, fn) {
  attempt(() => {
    if (!Array.isArray(list)) return
    const length = list.length
    for (let i = 0; i < length; i++) attempt(() => fn(list[i]))
  })
}

function attempt(fn) {
  try {
    return fn()
  } catch {
    return null
  }
}

// Counting

function newest(votes) {
  const latest = new Map()
  for (const vote of votes) {
    const seen = latest.get(vote.voter)
    if (!seen || vote.n > seen.n || (vote.n === seen.n && wins(vote, seen))) {
      latest.set(vote.voter, vote)
    }
  }
  return [...latest.values()].sort((a, b) => (a.voter < b.voter ? -1 : 1))
}

function wins(a, b) {
  if (a.tie !== b.tie) return a.tie < b.tie
  return a.choices.join(',') < b.choices.join(',')
}

// Signed text

function line(field) {
  if (typeof field !== 'string' || field.includes('\n') || LONE_SURROGATE.test(field)) {
    throw new Error('fields must be one-line strings')
  }
  return field
}

function fields(extra) {
  const list = arrayOf(extra, Infinity)
  if (list === null) throw new Error('extra must be an array')
  return list.map((field) => (Number.isSafeInteger(field) ? String(field) : line(field)))
}

// A lone surrogate becomes U+FFFD in UTF-8, so two different strings would sign the same bytes.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

function isN(n, b = null) {
  return isUint(n) && n >= 1 && (b === null || n <= b.maxVersions)
}

function isTie(tie, b = null) {
  return typeof tie === 'string' && tie.length >= 1 && (b === null || tie.length <= b.maxTie)
}

function within(n, min, max) {
  return isUint(n) && n >= min && n <= max
}

function isUint(n) {
  return Number.isSafeInteger(n) && n >= 0
}

module.exports = {
  MODES,
  LIMITS,
  define,
  isChoices,
  isVote,
  isCut,
  prefer,
  cutOf,
  nextN,
  counted,
  tally,
  missing,
  signable,
  signableClose
}
