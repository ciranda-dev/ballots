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

// `tie` names one signed version: your app derives it, such as a hash of the signed text
const votes = [
  { voter: 'ana', n: 1, choices: [0], tie: '5e1a' },
  { voter: 'bruno', n: 1, choices: [2], tie: 'c07d' }
]

// Bruno changes his vote: one past his highest n
const n = ballots.nextN(lunch, votes, 'bruno') // 2
const change = { voter: 'bruno', n, choices: [1], tie: '8b2f' }
if (ballots.isVote(lunch, change)) votes.push(change)

ballots.tally(lunch, votes).counts // [1, 1, 0], while it is open

// Close it with the votes the closer has
const close = { counted: ballots.cutOf(lunch, votes) } // [['ana', 1, '5e1a'], ['bruno', 2, '8b2f']]

// Votes signed after the close are kept, and never count: another version of Bruno's n 2, and Cris
votes.push({ voter: 'bruno', n: 2, choices: [0], tie: '01c4' })
votes.push({ voter: 'cris', n: 1, choices: [2], tie: 'f93e' })

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
   their `tie`: a short string your app derives from each signed version. The smaller is kept, and
   equal ties fall back to the choices, so the order they arrive in never matters.
3. **A close lists exactly the versions it counts**, `[[voter, n, tie], ...]`, built by the closer
   from the votes they have. From then on, every peer counts those versions and only those.
4. **A vote signed after the close** is kept, so its voter can see it wasn't counted. It never
   counts, wherever the log puts it, even as another version of an `n` the close lists.

Logical counters instead of clocks: a clock can be wrong or forged, and peers have no shared
"now". A counter that each voter increases only orders that voter's own votes, which is all a
ballot needs.

## Security

`@ciranda/ballots` is designed for open, named votes among identities your app admits. Votes are
not secret, and one identity is not one person.

Whoever closes a ballot decides what it counts. A close can leave a voter out, or list an older
version of their vote than their newest. Every peer then counts the same thing, and the votes it
left out stay in the log for anyone to see, but no rule here stops it. Let only someone your
voters trust close a ballot, and show what a close left out.

Your app checks signatures, picks the `tie`, and stores only a close whose every version it holds.
That list, and what the package does and does not promise, is in
[`docs/threat-model.md`](docs/threat-model.md).

## API

### `define(spec[, limits])`

Returns a frozen ballot definition, or `null` if `spec` or `limits` is invalid.

| Field     | Type     | Default    | Description                                         |
| --------- | -------- | ---------- | --------------------------------------------------- |
| `options` | `number` |            | Number of options.                                  |
| `mode`    | `string` | `'single'` | `'single'`, `'multiple'` or `'scale'`.              |
| `levels`  | `number` | `0`        | Levels per option on a `'scale'` ballot, 2 or more. |

`limits` overrides the defaults in `LIMITS`. Each must be a whole number in its range, and
`minOptions` no more than `maxOptions`:

| Limit         | Default | Range      | Description                        |
| ------------- | ------- | ---------- | ---------------------------------- |
| `minOptions`  | `2`     | 1 to 256   | Fewest options a ballot may have.  |
| `maxOptions`  | `64`    | 1 to 256   | Most options a ballot may have.    |
| `maxLevels`   | `16`    | 2 to 256   | Most levels on a `'scale'` ballot. |
| `maxVersions` | `1000`  | 1 or more  | Highest `n` a vote may carry.      |
| `maxVoters`   | `4096`  | 1 to 65536 | Most voters a close may list.      |
| `maxTie`      | `128`   | 1 to 1024  | Longest `tie`, as its `length`.    |

A voter who reaches `maxVersions` can't change their vote again, and a ballot with more than
`maxVoters` voters can't be closed with all of them. Pick limits above what your app will see.

### Votes and closes

A vote is `{ voter, n, choices, tie }`. A close is `{ counted }`, where `counted` is
`[[voter, n, tie], ...]` sorted by voter.

Apart from `signable()` and `signableClose()`, none of these throws, whatever it is given. Each
reads a record's fields once, so what it checked is what it counts. The votes they return are
copies, `{ voter, n, choices, tie }`.

- Pass the ballot `define()` returned, so your limits hold. Any other ballot, such as one read back
  from the log, is checked against the ranges above, and nothing counts if it falls outside them.
- Pass only the votes of that one ballot: a vote's own `ballot` field is never read.
- A close that isn't a valid list counts nothing.

| Function                          | Returns                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `isChoices(ballot, choices)`      | Whether `choices` fits the ballot: one index, increasing indexes, one level per option, or `[]` to take a vote back.    |
| `isVote(ballot, vote)`            | Whether `vote` has a valid shape for the ballot.                                                                        |
| `isCut(ballot, counted)`          | Whether a close's list is valid: sorted, no voter twice, within `maxVoters`.                                            |
| `prefer(a, b)`                    | Of two versions with the same voter and `n`, the one to keep: the smaller `tie`, then the smaller choices.              |
| `nextN(ballot, votes, voter)`     | The `n` for that voter's next vote, or `null` past `maxVersions`. Only valid votes count.                               |
| `cutOf(ballot, votes)`            | What a close written now lists: each voter's newest valid vote.                                                         |
| `counted(ballot, votes[, close])` | The votes that count, sorted by voter.                                                                                  |
| `tally(ballot, votes[, close])`   | `{ counts, voters, voted, votes }`. On a `'scale'` ballot, `counts[option][level]`.                                     |
| `missing(eligible, votes)`        | The eligible voters with no counted vote, sorted.                                                                       |
| `signable(vote[, options])`       | The exact text to sign for a vote: `domain`, `scope`, the ballot, the voter, `n`, any `extra` fields, then the choices. |
| `signableClose(close[, options])` | The exact text to sign for a close: `domain`, `scope`, the ballot, any `extra` fields, then `counted` as JSON.          |

### Signing

The package does no cryptography. Sign the text from `signable()` with the voter's own key, and
check the signature against the same text before you store a vote. The text names the voter, so a
signature can't be moved to another spelling of their key.

| Option   | Default                               | Description                                                                         |
| -------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| `domain` | `'ballots/vote'` or `'ballots/close'` | A label for your app and record kind, so a signature for one can't pass as another. |
| `scope`  | `''`                                  | Where the ballot lives (a room, a group), so a vote can't be replayed elsewhere.    |
| `extra`  | `[]`                                  | Your app's own fields, signed in order.                                             |

Each field is a one-line string with no lone surrogate, so one field can never be read as two and
two strings never encode to the same bytes. `extra` is an array of such strings or safe integers,
written in decimal: `5` and `'5'` sign alike, so check the type of each field yourself.

`signable()` and `signableClose()` throw on anything else. They run when a vote is signed or
checked, so in `apply` check the record first, as the example does, or catch.

Derive the `tie` from what was signed, such as the hex of a hash of the signed text, and never take
it from the record. A tie someone else picks lets them pick which of a voter's versions counts.

### Constants

`MODES`, `LIMITS`, both frozen.

## Autobase apps

The functions only need the records your view already holds, so they fit an `apply` handler as
they are. [`examples/autobase.js`](examples/autobase.js) is a room with three writers and a
Hyperbee view that keeps every version of every vote under `votes/<ballot>/<voter>/<n>/<tie>`, and
never replaces one. Its vote handler, with small helpers (`isId`, `verify`, `voteKey`…) defined in
the same file:

```js
async function applyVote({ ballot: id, voter, n, choices, signature }, view, host) {
  const ballot = isId(id) ? await view.get('ballots/' + id) : null
  if (!ballot || !isKey(voter) || !isSignature(signature)) return
  const definition = definitionOf(ballot.value)
  // checked before signable(), which throws on what isn't a vote
  if (!ballots.isChoices(definition, choices) || !Number.isSafeInteger(n) || n < 1) return
  const text = ballots.signable({ ballot: id, voter, n, choices }, signing(VOTE, host))
  const vote = { voter, n, choices, tie: hex(crypto.hash(b4a.from(text))) }
  if (!ballots.isVote(definition, vote)) return
  if (!verify(text, signature, voter)) return
  if (!(await view.get('members/' + voter))) return
  const key = voteKey(id, voter, n, vote.tie)
  if (!(await view.get(key))) await view.put(key, { ...vote, signature })
}
```

Its close handler keeps the first valid close of a ballot in Autobase's order: signed over
`signableClose()` by whoever opened the ballot, `isCut`, and every version it lists already in the
view. The tally is `ballots.tally()` over the stored votes and the close. The example and its tests
run in Node and Bare; see [`examples/README.md`](examples/README.md).

Autobase orders each node after the nodes its writer had seen, so a close comes after the votes
it lists and a vote after its ballot. Nothing has to wait in a queue.

## Development

```sh
npm install
npm test                      # npm run test:node (with coverage) and npm run test:bare
npm run lint
node examples/autobase.js     # the Autobase example
```

`npm run test:bare` and `bare examples/autobase.js` need [Bare](https://github.com/holepunchto/bare)
(`npm install -g bare`). The examples and tests use Holepunch modules as dev dependencies only.

Changes must keep the package free of I/O, clocks and dependencies, and every rule the same on
every peer. Issues and pull requests are welcome.

## License

Apache-2.0. Copyright 2026 [Ciranda](https://ciranda.dev). See [LICENSE](LICENSE) and
[NOTICE](NOTICE).
