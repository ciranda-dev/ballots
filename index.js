// Open, named ballots over a replicated append-only log (Autobase and the like). Pure functions:
// no I/O, no clock, no dependencies. The host checks signatures and membership and stores the
// records; this says what a record may be and what the records add up to.

const MODES = ['single', 'multiple', 'scale']

const LIMITS = {
  minOptions: 2,
  maxOptions: 64,
  maxLevels: 16,
  maxVersions: 1000,
  maxVoters: 4096
}

function define(spec, limits = {}) {
  const bounds = { ...LIMITS, ...limits }
  if (spec === null || typeof spec !== 'object') return null
  const { options, mode = 'single', levels = 0 } = spec
  if (!MODES.includes(mode)) return null
  if (!isUint(options) || options < bounds.minOptions || options > bounds.maxOptions) return null
  const scale = mode === 'scale'
  if (scale ? !isUint(levels) || levels < 2 || levels > bounds.maxLevels : levels !== 0) return null
  const { maxVersions, maxVoters } = bounds
  return Object.freeze({ options, mode, levels, maxVersions, maxVoters })
}

function isChoices(ballot, choices) {
  if (!Array.isArray(choices)) return false
  if (choices.length === 0) return true
  if (ballot.mode === 'scale') {
    return choices.length === ballot.options && choices.every((c) => isUint(c) && c < ballot.levels)
  }
  if (ballot.mode === 'single' && choices.length !== 1) return false
  // strictly increasing: in range, no duplicates, and only one way to write each set
  return choices.every((c, i) => isUint(c) && c < ballot.options && (i === 0 || c > choices[i - 1]))
}

function isVote(ballot, vote) {
  return (
    vote !== null &&
    typeof vote === 'object' &&
    typeof vote.voter === 'string' &&
    isUint(vote.n) &&
    vote.n >= 1 &&
    vote.n <= ballot.maxVersions &&
    isChoices(ballot, vote.choices)
  )
}

function isCut(ballot, cut) {
  if (!Array.isArray(cut) || cut.length > ballot.maxVoters) return false
  return cut.every(
    (entry, i) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === 'string' &&
      isUint(entry[1]) &&
      entry[1] >= 1 &&
      entry[1] <= ballot.maxVersions &&
      (i === 0 || entry[0] > cut[i - 1][0])
  )
}

// Two versions with the same voter and n (two of their devices at once): the smaller tie (the
// host's signed bytes, as a string) is kept, so arrival order never matters.
function prefer(a, b) {
  return b.tie < a.tie ? b : a
}

function newest(votes) {
  const latest = new Map()
  for (const vote of votes) {
    const seen = latest.get(vote.voter)
    if (!seen || vote.n > seen.n || (vote.n === seen.n && prefer(seen, vote) === vote)) {
      latest.set(vote.voter, vote)
    }
  }
  return [...latest.values()].sort((a, b) => (a.voter < b.voter ? -1 : 1))
}

function cutOf(votes) {
  return newest(votes).map((vote) => [vote.voter, vote.n])
}

function nextN(votes, voter) {
  let n = 0
  for (const vote of votes) if (vote.voter === voter && vote.n > n) n = vote.n
  return n + 1
}

function counted(ballot, votes, close = null) {
  const valid = votes.filter((vote) => isVote(ballot, vote))
  if (close === null) return newest(valid)
  return newest(valid.filter((vote) => listed(close.counted, vote.voter, vote.n)))
}

function tally(ballot, votes, close = null) {
  const scale = ballot.mode === 'scale'
  const counts = []
  const voters = []
  for (let i = 0; i < ballot.options; i++) {
    counts.push(scale ? new Array(ballot.levels).fill(0) : 0)
    voters.push(scale ? Array.from({ length: ballot.levels }, () => []) : [])
  }
  const cast = counted(ballot, votes, close).filter((vote) => vote.choices.length > 0)
  for (const { voter, choices } of cast) {
    choices.forEach((choice, i) => {
      const option = scale ? i : choice
      const cell = scale ? voters[option][choice] : voters[option]
      if (scale) counts[option][choice]++
      else counts[option]++
      cell.push(voter)
    })
  }
  return { counts, voters, voted: cast.length, votes: cast }
}

function missing(eligible, cast) {
  const voted = new Set(cast.map((vote) => vote.voter))
  return [...new Set(eligible)].filter((voter) => !voted.has(voter)).sort()
}

// The exact text a voter signs, so every peer checks the same bytes. `scope` binds the vote to its
// place (a room, a group) so it can't be replayed elsewhere; `extra` holds the app's own fields.
// The voter is the signing key, so it isn't repeated here. Fields can't hold a line break, which
// keeps one field from being read as two.
function signable(vote, { domain = 'ballots/vote', scope = '', extra = [] } = {}) {
  const choices = Array.isArray(vote?.choices) ? vote.choices : null
  if (!choices || !choices.every(isUint) || !isUint(vote.n) || typeof vote.ballot !== 'string') {
    throw new Error('not a vote')
  }
  return lines([domain, scope, vote.ballot, String(vote.n), ...extra, choices.join(',')])
}

// The same for a close: the counted list goes last, as JSON.
function signableClose(close, { domain = 'ballots/close', scope = '', extra = [] } = {}) {
  if (!Array.isArray(close?.counted) || typeof close.ballot !== 'string') {
    throw new Error('not a close')
  }
  return lines([domain, scope, close.ballot, ...extra, JSON.stringify(close.counted)])
}

function lines(fields) {
  for (const field of fields) {
    const text = typeof field === 'number' ? String(field) : field
    if (typeof text !== 'string' || text.includes('\n')) {
      throw new Error('fields must be one-line strings')
    }
  }
  return fields.map(String).join('\n')
}

function listed(cut, voter, n) {
  return cut.some((entry) => entry[0] === voter && entry[1] === n)
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
