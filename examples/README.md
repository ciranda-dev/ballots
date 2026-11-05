# Examples

## `autobase.js`

Three people vote in one [Autobase](https://github.com/holepunchto/autobase) room. Each person has
their own Corestore in a temp dir, and the three bases replicate in the same process, as in
Autobase's own tests. The view is a [Hyperbee](https://github.com/holepunchto/hyperbee).

Each vote is signed with the voter's ed25519 key over `ballots.signable()`, and the room's key is
its `scope`. `apply` takes:

- a member only from the room's creator;
- a ballot from a member's writer, who may then close it;
- a vote with a valid signature from a member, that passes `isVote`. Every version is kept by
  `(ballot, voter, n)`, the smaller `tie` when two have the same `n`, and none is replaced once the
  ballot is closed;
- the first valid close of a ballot: signed by whoever opened it, `isCut`, and listing only votes
  the view holds.

The results are counted with `ballots.tally()`.

```sh
npm install
node examples/autobase.js
bare examples/autobase.js   # with Bare installed: npm install -g bare
```

The output:

```text
ana opens "lunch": Where do we eat on Friday? Pizza, Sushi, Tacos

ana votes Pizza, bruno Tacos, cris Sushi
  Pizza  1  ana
  Sushi  1  cris
  Tacos  1  bruno

bruno changes his vote to Sushi (n = 2)
  Pizza  1  ana
  Sushi  2  bruno, cris
  Tacos  0

cris's device appends a vote for Tacos in ana's name, signed with cris's key
  refused: no peer stores it
  Pizza  1  ana
  Sushi  2  bruno, cris
  Tacos  0

ana closes the ballot, counting ana 1, bruno 2, cris 1

cris votes Tacos after the close (n = 2)
  stored, not counted

final tally, the same on all three peers
  Pizza  1  ana
  Sushi  2  bruno, cris
  Tacos  0
  voted 3 of 3, missing: none
```

[`test/autobase.js`](../test/autobase.js) runs the same code and checks the outcome, also when the
writers append without seeing each other and then replicate in different orders.

The Holepunch modules here (`autobase`, `corestore`, `hyperbee`, `hypercore-crypto`, `b4a`,
`test-tmp`, `autobase-test-helpers`) are dev dependencies. `@ciranda/ballots` itself has none.
