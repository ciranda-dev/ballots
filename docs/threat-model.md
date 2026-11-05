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
  where the ballot lives, and the signature is checked before the vote is stored.
- Each close is signed over the text from `signableClose()` and comes from someone your app lets
  close the ballot.
- A vote is stored only if its voter may vote at that place in the log.
- Once a ballot is closed, a stored vote is never replaced by another version with the same voter
  and `n`. The close lists `[voter, n]`, not the version, so a version the voter signs after the
  close could otherwise win on its `tie` and change the closed result.

Without these, the promises below do not hold.

## The promise

With the above in place, every peer that holds the same records computes the same result, in any
order.

In detail:

- A voter's counted vote is their vote with the highest `n`. A copy of an older vote, written
  again by anyone, changes nothing.
- Two versions with the same voter and `n` are decided by their `tie`, so the order they arrive in
  never matters.
- A closed ballot counts exactly the votes its close lists, and no other. A vote that arrives
  after the close never counts.
- Choices outside the ballot's shape (out of range, repeated, two on a one-answer ballot) never
  count.
- No clock is read and no timestamp is compared.

## What is a wall and what is not

A **No** row cannot be the basis of a bug report.

| Thing                                      | Is it a wall? | Why                                                                                         |
| ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------- |
| One voter's vote <-> another voter         | Yes           | Votes are signed by their voter over the ballot, `n` and the choices                        |
| A vote <-> another ballot or scope         | Yes           | The signed text names the ballot and the scope                                              |
| A closed result <-> votes it doesn't list  | Yes           | A closed ballot counts only what its close lists                                            |
| The result <-> the order records arrive in | Yes           | Newest by `n`, ties by `tie`, the close by its list                                         |
| Who voted for what <-> other readers       | No            | Votes are open and named. Anyone who can read the log sees them, and keeps what they saw    |
| One vote <-> one person                    | No            | A voter is an identity your app admits. Someone with several identities votes several times |
| A voter <-> proving how they voted         | No            | A signed vote is a receipt anyone can check                                                 |
| A ballot <-> a clock time                  | No            | A close is a record someone writes, not a time                                              |
| An open ballot's counts <-> other peers    | No            | Each peer counts the votes that have reached it                                             |
| A deleted ballot <-> the log               | No            | An append-only log keeps every record. Your app can stop showing votes, not erase them      |
