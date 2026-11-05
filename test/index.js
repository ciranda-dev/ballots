const test = require('brittle')
const ballots = require('..')

const single = ballots.define({ options: 3 })
const multiple = ballots.define({ options: 4, mode: 'multiple' })
const scale = ballots.define({ options: 2, mode: 'scale', levels: 3 })

const vote = (voter, n, choices, tie = voter + n) => ({ voter, n, choices, tie })

test('define', (t) => {
  t.alike(single, { options: 3, mode: 'single', levels: 0, maxVersions: 1000, maxVoters: 4096 })
  t.ok(Object.isFrozen(single))
  t.is(multiple.mode, 'multiple')
  t.is(scale.levels, 3)
  t.is(ballots.define({ options: 2 }, { maxVersions: 5, maxVoters: 7 }).maxVersions, 5)
  t.is(ballots.define(null), null)
  t.is(ballots.define('three'), null)
  t.is(ballots.define({ options: 3, mode: 'ranked' }), null)
  t.is(ballots.define({ options: 1 }), null, 'fewer than minOptions')
  t.is(ballots.define({ options: 65 }), null, 'more than maxOptions')
  t.is(ballots.define({ options: 11 }, { maxOptions: 10 }), null)
  t.is(ballots.define({ options: 2.5 }), null)
  t.is(ballots.define({ options: 2, mode: 'scale' }), null, 'a scale needs levels')
  t.is(ballots.define({ options: 2, mode: 'scale', levels: 1 }), null)
  t.is(ballots.define({ options: 2, mode: 'scale', levels: 17 }), null)
  t.is(ballots.define({ options: 2, mode: 'scale', levels: '3' }), null)
  t.is(ballots.define({ options: 2, levels: 3 }), null, 'levels only on a scale')
})

test('isChoices', (t) => {
  t.ok(ballots.isChoices(single, []), 'none takes a vote back')
  t.ok(ballots.isChoices(single, [2]))
  t.absent(ballots.isChoices(single, [3]), 'out of range')
  t.absent(ballots.isChoices(single, [0, 1]), 'two on a one-answer ballot')
  t.absent(ballots.isChoices(single, [-1]))
  t.absent(ballots.isChoices(single, '0'))
  t.ok(ballots.isChoices(multiple, [0, 2, 3]))
  t.absent(ballots.isChoices(multiple, [2, 0]), 'not in order')
  t.absent(ballots.isChoices(multiple, [1, 1]), 'twice')
  t.absent(ballots.isChoices(multiple, [0, 1.5]))
  t.absent(ballots.isChoices(multiple, [0, 1, 2, 3, 4]))
  t.ok(ballots.isChoices(scale, [2, 0]))
  t.absent(ballots.isChoices(scale, [2]), 'one answer per option')
  t.absent(ballots.isChoices(scale, [3, 0]), 'past the levels')
  t.absent(ballots.isChoices(scale, [null, 0]))
})

test('isVote and isCut', (t) => {
  t.ok(ballots.isVote(single, vote('a', 1, [0])))
  t.absent(ballots.isVote(single, null))
  t.absent(ballots.isVote(single, 'vote'))
  t.absent(ballots.isVote(single, vote(7, 1, [0])))
  t.absent(ballots.isVote(single, vote('a', 0, [0])))
  t.absent(ballots.isVote(single, vote('a', 1001, [0])))
  t.absent(ballots.isVote(single, vote('a', 1.5, [0])))
  t.absent(ballots.isVote(single, vote('a', 1, [5])))
  t.ok(ballots.isCut(single, []))
  t.ok(
    ballots.isCut(single, [
      ['a', 1],
      ['b', 3]
    ])
  )
  t.absent(ballots.isCut(single, 'a'))
  t.absent(
    ballots.isCut(ballots.define({ options: 2 }, { maxVoters: 1 }), [
      ['a', 1],
      ['b', 1]
    ])
  )
  t.absent(
    ballots.isCut(single, [
      ['b', 1],
      ['a', 1]
    ]),
    'by voter'
  )
  t.absent(
    ballots.isCut(single, [
      ['a', 1],
      ['a', 2]
    ]),
    'one entry per voter'
  )
  t.absent(ballots.isCut(single, ['a']))
  t.absent(ballots.isCut(single, [['a', 1, 2]]))
  t.absent(ballots.isCut(single, [[1, 1]]))
  t.absent(ballots.isCut(single, [['a', 0]]))
  t.absent(ballots.isCut(single, [['a', 1001]]))
})

test('prefer, nextN', (t) => {
  const x = vote('a', 1, [0], 'x')
  const y = vote('a', 1, [1], 'y')
  t.is(ballots.prefer(x, y), x)
  t.is(ballots.prefer(y, x), x, 'whatever the order')
  t.is(ballots.nextN([], 'a'), 1)
  t.is(ballots.nextN([vote('a', 1, [0]), vote('a', 4, [1]), vote('b', 9, [2])], 'a'), 5)
})

test('counted, cutOf and tally: the newest open, exactly the cut once closed', (t) => {
  const votes = [
    vote('b', 1, [2]),
    vote('a', 1, [0]),
    vote('a', 2, [1]),
    vote('c', 1, []),
    vote('d', 1, [7]) // not a choice the ballot takes
  ]
  t.alike(ballots.cutOf(votes), [
    ['a', 2],
    ['b', 1],
    ['c', 1],
    ['d', 1]
  ])
  t.alike(
    ballots.counted(single, votes).map((v) => [v.voter, v.n]),
    [
      ['a', 2],
      ['b', 1],
      ['c', 1]
    ]
  )
  const open = ballots.tally(single, votes)
  t.alike(open.counts, [0, 1, 1])
  t.alike(open.voters, [[], ['a'], ['b']])
  t.is(open.voted, 2, 'a vote taken back is no vote')

  const close = {
    counted: [
      ['a', 1],
      ['b', 1],
      ['e', 1]
    ]
  }
  const shut = ballots.tally(single, votes, close)
  t.alike(shut.counts, [1, 0, 1], "a's first vote, as the close lists it")
  t.is(shut.voted, 2, 'e listed with no such vote: not counted')
  t.alike(ballots.missing(['a', 'b', 'c', 'c'], shut.votes), ['c'])

  const ties = [vote('a', 1, [2], 'z'), vote('a', 1, [0], 'k')]
  t.alike(ballots.tally(single, ties).counts, [1, 0, 0], 'the smaller tie')
  t.alike(ballots.tally(single, ties.reverse(), { counted: [['a', 1]] }).counts, [1, 0, 0])

  const many = ballots.tally(multiple, [vote('a', 1, [0, 3]), vote('b', 1, [3])])
  t.alike(many.counts, [1, 0, 0, 2])
  t.alike(many.voters[3], ['a', 'b'])

  const slots = ballots.tally(scale, [vote('a', 1, [2, 0]), vote('b', 1, [2, 1])])
  t.alike(slots.counts, [
    [0, 0, 2],
    [1, 1, 0]
  ])
  t.alike(slots.voters[0][2], ['a', 'b'])
  t.alike(slots.voters[1], [['a'], ['b'], []])
})

test('the same records in any order count the same', (t) => {
  const records = []
  for (const voter of ['a', 'b', 'c', 'd']) {
    for (let n = 1; n <= 3; n++) records.push(vote(voter, n, [(n + voter.charCodeAt(0)) % 3]))
  }
  records.push(vote('a', 3, [0], 'a3-other'), vote('b', 2, [9]))
  const close = { counted: ballots.cutOf(records.slice(0, 7)) }
  const expected = ballots.tally(single, records, close)
  const expectedOpen = ballots.tally(single, records)
  let seed = 7
  for (let round = 0; round < 50; round++) {
    const order = [...records]
    for (let i = order.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      const j = seed % (i + 1)
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    t.alike(ballots.tally(single, order, close).counts, expected.counts)
    t.alike(ballots.tally(single, order).counts, expectedOpen.counts)
    // a vote stored after the close, wherever it lands, never changes what the close counts
    const later = [...order, vote('d', 9, [2]), vote('a', 9, [1])]
    t.alike(ballots.tally(single, later, close).counts, expected.counts)
  }
})

test('signable: the exact lines a voter signs', (t) => {
  const vote = { ballot: 'poll/1', n: 2, choices: [0, 3] }
  t.is(ballots.signable(vote), 'ballots/vote\n\npoll/1\n2\n0,3')
  t.is(
    ballots.signable(vote, { domain: 'app/vote', scope: 'room-key', extra: [1700000000000] }),
    'app/vote\nroom-key\npoll/1\n2\n1700000000000\n0,3'
  )
  t.is(
    ballots.signable({ ballot: 'b', n: 1, choices: [] }),
    'ballots/vote\n\nb\n1\n',
    'a vote taken back'
  )
  t.not(
    ballots.signable(vote, { scope: 'room-a' }),
    ballots.signable(vote, { scope: 'room-b' }),
    'another scope, other bytes'
  )
  t.exception(
    () => ballots.signable({ ballot: 'a\nb', n: 1, choices: [0] }),
    'no line break in a field'
  )
  t.exception(() => ballots.signable(vote, { scope: 'x\ny' }))
  t.exception(() => ballots.signable({ ballot: 'b', n: -1, choices: [0] }))
  t.exception(() => ballots.signable({ ballot: 'b', n: 1, choices: [1.5] }))
  t.exception(() => ballots.signable({ ballot: 'b', n: 1 }))
  t.exception(() => ballots.signable(null))
  t.exception(() => ballots.signable({ ballot: 2, n: 1, choices: [0] }), 'the ballot is a string')
})

test('signableClose: the counted list, last', (t) => {
  const close = {
    ballot: 'poll/1',
    counted: [
      ['ana', 1],
      ['bruno', 2]
    ]
  }
  t.is(ballots.signableClose(close), 'ballots/close\n\npoll/1\n[["ana",1],["bruno",2]]')
  t.is(
    ballots.signableClose(close, { domain: 'app/close', scope: 'r', extra: [5] }),
    'app/close\nr\npoll/1\n5\n[["ana",1],["bruno",2]]'
  )
  t.exception(() => ballots.signableClose({ ballot: 'b' }))
  t.exception(() => ballots.signableClose(null))
})

test('signableClose: the ballot is a string', (t) => {
  t.exception(() => ballots.signableClose({ ballot: 1, counted: [] }))
})
