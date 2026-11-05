# Threat model

## What this is

`@ciranda/ballots` decides which votes count and what they add up to, for ballots kept in a
replicated, append-only log. It is meant for open, named votes among identities your app admits.
It is not meant for secret ballots.

What follows says what the package promises, what it does not, and which of the two a bug report
falls under.

## What counts

- **Counts:** `index.js`.
- **Does not count:** your app. Signing votes and checking signatures, deciding who may vote and
  who may close, storing records and showing results are your app's, and so is everything they
  depend on.

## What the package needs from your app

- Each vote is signed by its voter over the text from `signable()`, with a `scope` that names
  where the ballot lives, and the signature is checked before the vote is stored. The text names
  the voter, so check it against the key that voter string stands for.
- Each vote's `tie` is derived by your app from that signed version, such as the hex of a hash of
  the signed text. It is never taken from the record: a tie someone else picks lets them pick
  which of a voter's versions counts.
- A vote is stored only if its voter may vote at that place in the log.
- Each close is signed over the text from `signableClose()` and comes from someone your app lets
  close the ballot.
- A close is stored only if every version it lists, `[voter, n, tie]`, is one your app holds.
  Otherwise a close could list a version nobody has signed yet, and count it once someone does.
- A version a stored close lists is never removed or replaced. If it were, that voter would drop
  out of the closed result. Keeping every version, as the example does, is the simplest way.
- Of two valid closes of one ballot, the first in the log's order stands, an order every peer
  shares. The package has no rule for this: picking by arrival would let peers disagree.
- A ballot id is defined once, and a later definition with the same id is refused. The signed text
  names the id, not the options, so one vote would fit both.
- `counted()` and `tally()` get only the votes of that ballot. They never read a vote's own
  `ballot` field.
- `signable()` and `signableClose()` throw on anything that isn't a vote or a close. A throw in
  `apply` stops the log on every peer, so check the record before calling them, or catch.

Without these, the promises below do not hold.

## The promise

With the above in place, every peer that holds the same records computes the same result, in any
order.

In detail:

- A voter's counted vote is their vote with the highest `n`. A copy of an older vote, written
  again by anyone, changes nothing.
- Two versions with the same voter and `n` are decided by their `tie`, then their choices, so the
  order they arrive in never matters. A vote without a string `tie` never counts.
- A closed ballot counts exactly the versions its close lists, and no other. A version signed after
  the close never counts, even at a voter and `n` the close lists.
- Choices outside the ballot's shape (out of range, repeated, two on a one-answer ballot, a hole in
  the list) never count.
- Nothing on the apply path (`define`, `isChoices`, `isVote`, `isCut`, `prefer`, `cutOf`, `nextN`,
  `counted`, `tally`, `missing`) throws, whatever it is given. Each reads a field once, so a getter
  can't show it one value and count another.
- No clock is read and no timestamp is compared.

## What the closer decides

Whoever closes a ballot picks what it counts. A close can leave voters out, or list an older
version of someone's vote than their newest. Every peer counts the same thing, and the versions
left out stay in the log, but nothing in the package stops such a close. Your app chooses who may
close, and can show what a close left out.

## What is a wall and what is not

A **No** row cannot be the basis of a bug report.

| Thing                                        | Is it a wall? | Why                                                                                         |
| -------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| One voter's vote <-> another voter           | Yes           | Votes are signed by their voter over the ballot, the voter, `n` and the choices             |
| A vote <-> another ballot or scope           | Yes           | The signed text names the ballot and the scope                                              |
| A closed result <-> versions it doesn't list | Yes           | A close names each version it counts by its `tie`                                           |
| The result <-> the order records arrive in   | Yes           | Newest by `n`, ties by `tie` then choices, the close by its list                            |
| A closed result <-> the closer               | No            | The closer picks which versions count, and can leave voters out                             |
| Who voted for what <-> other readers         | No            | Votes are open and named. Anyone who can read the log sees them, and keeps what they saw    |
| One vote <-> one person                      | No            | A voter is an identity your app admits. Someone with several identities votes several times |
| A voter <-> proving how they voted           | No            | A signed vote is a receipt anyone can check                                                 |
| A ballot <-> a clock time                    | No            | A close is a record someone writes, not a time                                              |
| An open ballot's counts <-> other peers      | No            | Each peer counts the votes that have reached it                                             |
| Every voter <-> a close                      | No            | A close lists at most `maxVoters`, and a voter at `maxVersions` can't change their vote     |
| A deleted ballot <-> the log                 | No            | An append-only log keeps every record. Your app can stop showing votes, not erase them      |
