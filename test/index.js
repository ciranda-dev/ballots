const test = require('brittle')
const ballots = require('..')

const single = ballots.define({ options: 3 })
const multiple = ballots.define({ options: 4, mode: 'multiple' })
const scale = ballots.define({ options: 2, mode: 'scale', levels: 3 })

const vote = (voter, n, choices, tie = voter + n) => ({ voter, n, choices, tie })

test('define', (t) => {
  t.alike(single, {
    options: 3,
    mode: 'single',
    levels: 0,
    maxVersions: 1000,
    maxVoters: 4096,
    maxTie: 128
  })
  t.ok(Object.isFrozen(single))
  t.is(multiple.mode, 'multiple')
  t.is(scale.levels, 3)
  t.is(ballots.define({ options: 2 }, { maxVersions: 5, maxVoters: 7 }).maxVersions, 5)
  t.is(ballots.define({ options: 1 }, { minOptions: 1 }).options, 1)
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

test('define checks the limits it is given', (t) => {
  const bad = [
    { maxVersions: undefined },
    { maxVersions: -5 },
    { maxVersions: 0 },
    { maxVoters: Infinity },
    { maxVoters: 65537 },
    { maxOptions: Infinity },
    { maxOptions: 257 },
    { maxLevels: 1 },
    { maxTie: 0 },
    { maxTie: 1025 },
    { minOptions: 0 },
    { minOptions: 5, maxOptions: 4 },
    { maxTie: '128' }
  ]
  for (const limits of bad) t.is(ballots.define({ options: 3 }, limits), null)
  t.is(ballots.define({ options: 3 }, null).maxTie, 128, 'no limits, the defaults')
  t.is(ballots.define({ options: 256 }, { maxOptions: 256 }).options, 256)
})

test('the constants are frozen', (t) => {
  t.ok(Object.isFrozen(ballots.MODES))
  t.ok(Object.isFrozen(ballots.LIMITS))
  t.alike(ballots.LIMITS, {
    minOptions: 2,
    maxOptions: 64,
    maxLevels: 16,
    maxVersions: 1000,
    maxVoters: 4096,
    maxTie: 128
  })
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
  t.absent(ballots.isChoices(single, new Array(1)), 'a hole')
  t.absent(ballots.isChoices(multiple, [0, , 2]), 'a hole') // eslint-disable-line no-sparse-arrays
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
  t.absent(ballots.isVote(single, { voter: 'a', n: 1, choices: [0] }), 'a vote needs a tie')
  t.absent(ballots.isVote(single, vote('a', 1, [0], '')))
  t.absent(ballots.isVote(single, vote('a', 1, [0], 5)))
  t.ok(ballots.isVote(single, vote('a', 1, [0], 'x'.repeat(128))))
  t.absent(ballots.isVote(single, vote('a', 1, [0], 'x'.repeat(129))), 'past maxTie')

  t.ok(ballots.isCut(single, []))
  t.ok(
    ballots.isCut(single, [
      ['a', 1, 'a1'],
      ['b', 3, 'b3']
    ])
  )
  t.absent(ballots.isCut(single, 'a'))
  t.absent(
    ballots.isCut(ballots.define({ options: 2 }, { maxVoters: 1 }), [
      ['a', 1, 't'],
      ['b', 1, 't']
    ])
  )
  t.absent(
    ballots.isCut(single, [
      ['b', 1, 't'],
      ['a', 1, 't']
    ]),
    'by voter'
  )
  t.absent(
    ballots.isCut(single, [
      ['a', 1, 't'],
      ['a', 2, 't']
    ]),
    'one entry per voter'
  )
  t.absent(ballots.isCut(single, ['a']))
  t.absent(ballots.isCut(single, [['a', 1]]), 'an entry names the version')
  t.absent(ballots.isCut(single, [['a', 1, 't', 2]]))
  t.absent(ballots.isCut(single, [[1, 1, 't']]))
  t.absent(ballots.isCut(single, [['a', 0, 't']]))
  t.absent(ballots.isCut(single, [['a', 1001, 't']]))
  t.absent(ballots.isCut(single, [['a', 1, '']]))
  t.absent(ballots.isCut(single, [['a', 1, 'x'.repeat(129)]]))
  t.absent(ballots.isCut(single, [['a', 1, 't'], , ['c', 1, 't']])) // eslint-disable-line no-sparse-arrays
})

test('prefer: the smaller tie, then the smaller choices, whatever the order', (t) => {
  const x = vote('a', 1, [0], 'x')
  const y = vote('a', 1, [1], 'y')
  t.is(ballots.prefer(x, y), x)
  t.is(ballots.prefer(y, x), x)
  const same = vote('a', 1, [2], 'x')
  t.is(ballots.prefer(x, same), x, 'equal ties: the smaller choices')
  t.is(ballots.prefer(same, x), x)
  t.is(ballots.prefer(null, x), x, 'one that is not a version loses')
  t.is(ballots.prefer(x, { choices: [0] }), x)
  t.is(ballots.prefer(x, { tie: 'a', choices: [-1] }), x)
  const a = {}
  t.is(ballots.prefer(a, 7), a)
})

test('nextN counts only valid votes', (t) => {
  t.is(ballots.nextN(single, [], 'a'), 1)
  const votes = [vote('a', 1, [0]), vote('a', 4, [1]), vote('b', 9, [2]), vote('a', 900, [7])]
  t.is(ballots.nextN(single, votes, 'a'), 5, 'n 900 is not a vote this ballot takes')
  t.is(ballots.nextN(single, [vote('a', 1000, [0])], 'a'), null, 'past maxVersions')
  t.is(ballots.nextN(null, votes, 'a'), null)
})

test('counted, cutOf and tally: the newest open, exactly the cut once closed', (t) => {
  const votes = [
    vote('b', 1, [2]),
    vote('a', 1, [0]),
    vote('a', 2, [1]),
    vote('a', 3, [9]), // not a choice the ballot takes
    vote('c', 1, []),
    vote('d', 1, [7])
  ]
  t.alike(ballots.cutOf(single, votes), [
    ['a', 2, 'a2'],
    ['b', 1, 'b1'],
    ['c', 1, 'c1']
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
  t.alike(open.votes[0], { voter: 'a', n: 2, choices: [1], tie: 'a2' })

  const close = {
    counted: [
      ['a', 1, 'a1'],
      ['b', 1, 'b1'],
      ['c', 1, 'other'],
      ['e', 1, 'e1']
    ]
  }
  const shut = ballots.tally(single, votes, close)
  t.alike(shut.counts, [1, 0, 1], "a's first vote, as the close lists it")
  t.is(shut.voted, 2, 'e listed with no such vote, c with another tie: not counted')
  t.alike(ballots.missing(['a', 'b', 'c', 'c', 'e'], shut.votes), ['c', 'e'])

  const ties = [vote('a', 1, [2], 'z'), vote('a', 1, [0], 'k')]
  t.alike(ballots.tally(single, ties).counts, [1, 0, 0], 'the smaller tie')
  t.alike(ballots.tally(single, ties.reverse(), { counted: [['a', 1, 'z']] }).counts, [0, 0, 1])

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

test('a close that is not a cut counts nothing', (t) => {
  const votes = [vote('a', 1, [0])]
  for (const close of [{}, { counted: 'x' }, { counted: [null] }, { counted: [['a', 1]] }, 7]) {
    t.alike(ballots.counted(single, votes, close), [])
    t.is(ballots.tally(single, votes, close).voted, 0)
  }
})

test('a version signed after the close never counts', (t) => {
  const before = [vote('ana', 1, [2], 'm'), vote('bruno', 1, [1], 'm')]
  const close = { counted: ballots.cutOf(single, before) }
  const fixed = ballots.tally(single, before, close)
  // the tie names one signed version, so a later one has another
  for (const tie of ['a', 'l', 'z']) {
    const late = vote('ana', 1, [0], tie)
    t.alike(ballots.tally(single, [...before, late], close), fixed)
    t.alike(ballots.tally(single, [late, ...before], close), fixed)
  }
})

test('missing', (t) => {
  t.alike(ballots.missing(['b', 'a', 'c'], [vote('a', 1, [0])]), ['b', 'c'])
  t.alike(ballots.missing(['a', 7, null], [null, 'x', { voter: 7 }]), ['a'])
  t.alike(ballots.missing('ab', 'a'), [])
})

test('signable: the exact lines a voter signs', (t) => {
  const vote = { ballot: 'poll/1', voter: 'ana', n: 2, choices: [0, 3] }
  t.is(ballots.signable(vote), 'ballots/vote\n\npoll/1\nana\n2\n0,3')
  t.is(
    ballots.signable(vote, {
      domain: 'app/vote',
      scope: 'room-key',
      extra: [1700000000000, 'phone']
    }),
    'app/vote\nroom-key\npoll/1\nana\n2\n1700000000000\nphone\n0,3'
  )
  t.is(
    ballots.signable({ ballot: 'b', voter: 'v', n: 1, choices: [] }),
    'ballots/vote\n\nb\nv\n1\n',
    'a vote taken back'
  )
  t.not(
    ballots.signable(vote, { scope: 'room-a' }),
    ballots.signable(vote, { scope: 'room-b' }),
    'another scope, other bytes'
  )
  t.not(ballots.signable(vote), ballots.signable({ ...vote, voter: 'ANA' }), 'another voter')
  const bad = [
    { ...vote, ballot: 'a\nb' },
    { ...vote, voter: 'a\nb' },
    { ...vote, voter: undefined },
    { ...vote, ballot: 2 },
    { ...vote, ballot: 'poll\ud800' },
    { ...vote, n: -1 },
    { ...vote, n: 0 },
    { ...vote, choices: [1.5] },
    { ...vote, choices: new Array(1) },
    { ...vote, choices: undefined },
    null
  ]
  for (const record of bad) t.exception(() => ballots.signable(record))
  t.exception(() => ballots.signable(vote, { scope: 'x\ny' }), 'no line break in a field')
  t.exception(() => ballots.signable(vote, { domain: 5 }))
  t.exception(() => ballots.signable(vote, { extra: 'ab' }), 'extra is an array')
  t.exception(() => ballots.signable(vote, { extra: [1.5] }))
  t.exception(() => ballots.signable(vote, { extra: [NaN] }))
  t.exception(() => ballots.signable(vote, { extra: [1e21] }))
  t.exception(() => ballots.signable(vote, { extra: [null] }))
  t.exception(() => ballots.signable(vote, { extra: ['\udfff'] }))
  t.ok(ballots.signable({ ...vote, ballot: 'poll 😀' }), 'a well-formed pair is fine')
})

test('signableClose: the counted list, last', (t) => {
  const close = {
    ballot: 'poll/1',
    counted: [
      ['ana', 1, 'a1'],
      ['bruno', 2, 'b2']
    ]
  }
  t.is(ballots.signableClose(close), 'ballots/close\n\npoll/1\n[["ana",1,"a1"],["bruno",2,"b2"]]')
  t.is(
    ballots.signableClose(close, { domain: 'app/close', scope: 'r', extra: [5] }),
    'app/close\nr\npoll/1\n5\n[["ana",1,"a1"],["bruno",2,"b2"]]'
  )
  const bad = [
    { ballot: 'b' },
    { ballot: 1, counted: [] },
    { ballot: 'b', counted: [['a', 1]] },
    { ballot: 'b', counted: [['a', 0, 't']] },
    { ballot: 'b', counted: [['a', 1, '']] },
    { ballot: 'b', counted: [[1, 1, 't']] },
    { ballot: 'b', counted: [null] },
    null
  ]
  for (const record of bad) t.exception(() => ballots.signableClose(record))
})
