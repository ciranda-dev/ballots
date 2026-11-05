<div align="center">

# @ciranda/ballots

Open, named ballots for apps built on a replicated, append-only log.

![status: experimental](https://img.shields.io/badge/status-experimental-orange)
![license: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)
![runtime: Node | Bare](https://img.shields.io/badge/runtime-Node%20%7C%20Bare-6e56cf)
![dependencies: none](https://img.shields.io/badge/dependencies-none-2b7489)

</div>

`@ciranda/ballots` decides what a vote may be and what the votes add up to, so every peer that
holds the same records computes the same result, in whatever order the records arrived. It is
made for multi-writer logs such as [Autobase](https://github.com/holepunchto/autobase): polls,
"find a time" answers, approvals, any question where each member gives one answer. Made by
[Ciranda](https://ciranda.dev).

## Features

- Each voter's latest vote is the one that counts.
- Closing a ballot fixes the result for every peer.
- Records can arrive in any order and still give the same tally.
- Single choice, multiple choice, or a rating per option.
- No dependencies. Works in Node and Bare.

## Install

```sh
npm install @ciranda/ballots
```

## Usage

```js
const ballots = require('@ciranda/ballots')

const lunch = ballots.define({ options: 3, mode: 'single' })

const votes = [
  { voter: 'ana', n: 1, choices: [0], tie: 'ana-1' },
  { voter: 'bruno', n: 1, choices: [2], tie: 'bruno-1' }
]

// Bruno changes his vote: one past his highest n
const change = { voter: 'bruno', n: ballots.nextN(votes, 'bruno'), choices: [1], tie: 'bruno-2' }
if (ballots.isVote(lunch, change)) votes.push(change)

ballots.tally(lunch, votes).counts // [1, 1, 0], while it is open

// Close it with the votes the closer has
const close = { counted: ballots.cutOf(votes) } // [['ana', 1], ['bruno', 2]]

// A vote that arrives after the close is kept, and never counts
votes.push({ voter: 'cris', n: 1, choices: [2], tie: 'cris-1' })

const result = ballots.tally(lunch, votes, close)
result.counts // [1, 1, 0]
result.voters // [['ana'], ['bruno'], []]
ballots.missing(['ana', 'bruno', 'cris'], result.votes) // ['cris']
```

## How it works

1. **A vote is the voter's whole choice**, with `n`, the voter's own count of their votes on that
   ballot. Their newest vote is the one with the highest `n`. A copy of an older vote, written
   again by anyone, changes nothing.
2. **Two versions with the same `n`**, from the same voter on two devices at once, are decided by
   comparing their `tie` strings (the signed bytes, in your app). The smaller is kept.
3. **A close lists exactly the votes it counts**, `[[voter, n], ...]`, built by the closer from
   the votes they have. From then on, every peer counts those votes and only those.
4. **A vote that arrives after the close** is kept, so its voter can see it wasn't counted. It
   never counts, wherever the log puts it.

Logical counters instead of clocks: a clock can be wrong or forged, and peers have no shared
"now". A counter that each voter increases only orders that voter's own votes, which is all a
ballot needs.

## Security

`@ciranda/ballots` is designed for open, named votes among identities your app admits. Votes are
not secret, and one identity is not one person. What the package does and does not promise, and
what your app must do for it, is written down in [`docs/threat-model.md`](docs/threat-model.md).

## API

### `define(spec[, limits])`

Returns a frozen ballot definition, or `null` if `spec` is invalid.

| Field     | Type     | Default    | Description                                         |
| --------- | -------- | ---------- | --------------------------------------------------- |
| `options` | `number` |            | Number of options.                                  |
| `mode`    | `string` | `'single'` | `'single'`, `'multiple'` or `'scale'`.              |
| `levels`  | `number` | `0`        | Levels per option on a `'scale'` ballot, 2 or more. |

`limits` overrides the defaults in `LIMITS`:

| Limit         | Default | Description                        |
| ------------- | ------- | ---------------------------------- |
| `minOptions`  | `2`     | Fewest options a ballot may have.  |
| `maxOptions`  | `64`    | Most options a ballot may have.    |
| `maxLevels`   | `16`    | Most levels on a `'scale'` ballot. |
| `maxVersions` | `1000`  | Highest `n` a vote may carry.      |
| `maxVoters`   | `4096`  | Most voters a close may list.      |

### Votes and closes

A vote is `{ voter, n, choices, tie }`. A close is `{ counted }`, where `counted` is
`[[voter, n], ...]` sorted by voter.

| Function                          | Returns                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `isChoices(ballot, choices)`      | Whether `choices` fits the ballot: one index, increasing indexes, one level per option, or `[]` to take a vote back.       |
| `isVote(ballot, vote)`            | Whether `vote` has a valid shape for the ballot.                                                                           |
| `isCut(ballot, counted)`          | Whether a close's list is valid: sorted, no voter twice, within `maxVoters`.                                               |
| `prefer(a, b)`                    | Of two versions with the same voter and `n`, the one to keep.                                                              |
| `nextN(votes, voter)`             | The `n` for that voter's next vote.                                                                                        |
| `cutOf(votes)`                    | What a close written now lists: each voter's newest vote.                                                                  |
| `counted(ballot, votes[, close])` | The votes that count.                                                                                                      |
| `tally(ballot, votes[, close])`   | `{ counts, voters, voted, votes }`. On a `'scale'` ballot, `counts[option][level]`.                                        |
| `missing(eligible, votes)`        | The eligible voters with no counted vote, sorted.                                                                          |
| `signable(vote[, options])`       | The exact text to sign for a vote: `domain`, `scope`, the ballot, `n`, any `extra` fields, then the choices, one per line. |
| `signableClose(close[, options])` | The exact text to sign for a close: `domain`, `scope`, the ballot, any `extra` fields, then `counted` as JSON.             |

### Signing

The package does no cryptography. Sign the text from `signable()` with the voter's own key, and
check the signature against the same text before you store a vote. The voter is the signing key,
so the text doesn't repeat it.

| Option   | Default                               | Description                                                                         |
| -------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| `domain` | `'ballots/vote'` or `'ballots/close'` | A label for your app and record kind, so a signature for one can't pass as another. |
| `scope`  | `''`                                  | Where the ballot lives (a room, a group), so a vote can't be replayed elsewhere.    |
| `extra`  | `[]`                                  | Your app's own fields, signed in order.                                             |

Every field must be a one-line string (numbers are written in decimal), so one field can never be
read as two. Use the same signed bytes as the vote's `tie`.

### Constants

`MODES`, `LIMITS`.

## Autobase apps

The functions only need the records your view already holds, so they fit an `apply` handler as
they are. [`examples/autobase.js`](examples/autobase.js) is a room with three writers and a
Hyperbee view that keeps every version of every vote under `votes/<ballot>/<voter>/<n>`. Its vote
handler, with small helpers (`isId`, `verify`, `voteKey`…) defined in the same file:

```js
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
```

Its close handler keeps the first valid close of a ballot: signed over `signableClose()` by whoever
opened the ballot, `isCut`, and every vote it lists already in the view. The tally is
`ballots.tally()` over the stored votes and the close. The example and its tests run in Node and
Bare; see [`examples/README.md`](examples/README.md).

Autobase orders each node after the nodes its writer had seen, so a close comes after the votes
it lists and a vote after its ballot. Nothing has to wait in a queue.

## Development

```sh
npm install
npm test     # unit tests with coverage (brittle)
npm run lint
```

Changes must keep the package free of I/O, clocks and dependencies, and every rule the same on
every peer. Issues and pull requests are welcome.

## License

Apache-2.0. Copyright 2026 [Ciranda](https://ciranda.dev). See [LICENSE](LICENSE) and
[NOTICE](NOTICE).
