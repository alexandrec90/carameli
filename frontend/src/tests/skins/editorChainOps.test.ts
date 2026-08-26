import { describe, expect, it } from 'vitest'

import {
  CHAIN_ROWS, CHAIN_STEP_MS, DEFAULT_CHAIN_ROWS, DEFAULT_CHAIN_STEP_MS, OUT_PREFIX,
} from '../../skins/comic-book/bubbleChain'
import type { BubbleChain } from '../../skins/comic-book/bubbleChain'
import {
  NEW_CHAIN,
  clampRows,
  clampStepMs,
  cloneChain,
  hydrateChains,
  linkGroups,
  nextChainId,
  normalizeChainId,
  parseMessages,
  patchChainIn,
  propagateChains,
  syncChains,
} from '../../skins/comic-book/editor/chainOps'

const chain = (id: string, over: Partial<BubbleChain> = {}): BubbleChain => ({
  id,
  grow: true,
  stepMs: DEFAULT_CHAIN_STEP_MS,
  rows: DEFAULT_CHAIN_ROWS,
  sms: false,
  messages: [],
  ...over,
})

const linked = (linkTo: number | null, chain = '', panel = 0) => ({ panel, linkTo, chain })

describe('nextChainId', () => {
  it('is the first generated id nothing on the page is using', () => {
    expect(nextChainId([])).toBe('chain-1')
    expect(nextChainId([linked(null, 'chain-1')])).toBe('chain-2')
  })

  it('fills a gap left by a chain that was untied, rather than counting ever upward', () => {
    expect(nextChainId([linked(null, 'chain-2'), linked(null, '')])).toBe('chain-1')
  })
})

describe('linkGroups', () => {
  it('makes a group of one out of a bubble nothing links to', () => {
    expect(linkGroups([linked(null), linked(null)])).toEqual([[0], [1]])
  })

  // The field holds a single partner, so a column of any length is a run of pair links.
  it('joins a run of pair links into one group', () => {
    expect(linkGroups([linked(null), linked(0), linked(1)])).toEqual([[0, 1, 2]])
  })

  it('is symmetric — declaring the link on either end is the same group', () => {
    expect(linkGroups([linked(1), linked(null)])).toEqual([[0, 1]])
  })

  it('never joins across panels, since the two halves are never on screen together', () => {
    expect(linkGroups([linked(null, '', 0), linked(0, '', 1)])).toEqual([[0], [1]])
  })

  it('skips a link to nothing rather than following it', () => {
    expect(linkGroups([linked(9), linked(1)])).toEqual([[0], [1]])
  })

  it('lists groups and members in first-appearance order', () => {
    expect(linkGroups([linked(null), linked(3), linked(null), linked(null)])).toEqual([
      [0],
      [1, 3],
      [2],
    ])
  })
})

describe('propagateChains', () => {
  it('chains the whole linked group when one member carries an id', () => {
    const out = propagateChains([linked(null), linked(0, 'chain-1'), linked(1)])
    expect(out.map(b => b.chain)).toEqual(['chain-1', 'chain-1', 'chain-1'])
  })

  it('leaves a group no member is chained in alone', () => {
    expect(propagateChains([linked(null), linked(0)]).map(b => b.chain)).toEqual(['', ''])
  })

  // Linking a loose balloon onto a chained one is how a slot gets added without the
  // author naming anything.
  it('adopts a balloon linked onto a chain', () => {
    const out = propagateChains([linked(null, 'chain-1'), linked(0)])
    expect(out[1].chain).toBe('chain-1')
  })

  // Which end carries the id does not matter: the box was ticked on the thread, not on a
  // balloon, so a chained balloon pulls an unchained one in from either side.
  it('spreads the id downward as readily as upward', () => {
    const out = propagateChains([linked(null), linked(0, 'chain-1')])
    expect(out.map(b => b.chain)).toEqual(['chain-1', 'chain-1'])
  })

  it('keeps the first id when two chains are linked together, so its settings survive', () => {
    const out = propagateChains([linked(null, 'chain-1'), linked(0, 'chain-2')])
    expect(out.map(b => b.chain)).toEqual(['chain-1', 'chain-1'])
  })

  // Unlinking leaves a one-slot chain — which is exactly the lone composer a live thread
  // starts as, so it must not be cleared.
  it('leaves an unlinked chained balloon chained', () => {
    expect(propagateChains([linked(null, 'chain-1')])[0].chain).toBe('chain-1')
  })

  it('does not mutate the bubbles it was handed', () => {
    const before = [linked(null), linked(0, 'chain-1')]
    propagateChains(before)
    expect(before[0].chain).toBe('')
  })
})

describe('cloneChain', () => {
  it('copies the messages array rather than sharing it', () => {
    const base = chain('left', { messages: ['a'] })
    const copy = cloneChain(base)
    copy.messages.push('b')
    expect(base.messages).toEqual(['a'])
  })
})

describe('syncChains', () => {
  it('creates an entry for an id that has just appeared, growing in by default', () => {
    const out = syncChains([{ chain: 'left' }], [])
    expect(out).toEqual([{ id: 'left', ...NEW_CHAIN }])
    expect(NEW_CHAIN.grow).toBe(true)
  })

  it('keeps the settings of a chain that is still in use', () => {
    const before = [chain('left', { grow: false, stepMs: 300, messages: ['hi'] })]
    expect(syncChains([{ chain: 'left' }], before)).toEqual(before)
  })

  it('drops a chain no bubble names any more, so no orphan settings accumulate', () => {
    expect(syncChains([{ chain: 'left' }], [chain('left'), chain('gone')])).toHaveLength(1)
  })

  it('lists one entry per distinct name, in first-appearance order', () => {
    const out = syncChains(
      [{ chain: 'right' }, { chain: '' }, { chain: 'left' }, { chain: 'right' }],
      [],
    )
    expect(out.map(c => c.id)).toEqual(['right', 'left'])
  })

  it('never makes a chain out of the empty name', () => {
    expect(syncChains([{ chain: '' }, { chain: '' }], [])).toEqual([])
  })

  it('does not alias the entries it kept', () => {
    const before = [chain('left', { messages: ['a'] })]
    syncChains([{ chain: 'left' }], before)[0].messages.push('b')
    expect(before[0].messages).toEqual(['a'])
  })
})

describe('clampStepMs', () => {
  it('passes a delay inside the range through, rounded to whole ms', () => {
    expect(clampStepMs(640.4)).toBe(640)
  })

  it('clamps to the ends of the range the inspector offers', () => {
    expect(clampStepMs(0)).toBe(CHAIN_STEP_MS.min)
    expect(clampStepMs(99_999)).toBe(CHAIN_STEP_MS.max)
  })

  it('falls back to the default rather than propagating a NaN into a timer', () => {
    expect(clampStepMs(Number.NaN)).toBe(DEFAULT_CHAIN_STEP_MS)
    expect(clampStepMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_CHAIN_STEP_MS)
  })
})

describe('clampRows', () => {
  it('passes a row cap inside the range through, rounded to a whole row', () => {
    expect(clampRows(4.4)).toBe(4)
  })

  // A table of one row is a balloon, not a conversation; one of fifty is unreadable at
  // panel size. Both ends are held rather than trusted.
  it('clamps to the ends of the range the inspector offers', () => {
    expect(clampRows(0)).toBe(CHAIN_ROWS.min)
    expect(clampRows(999)).toBe(CHAIN_ROWS.max)
  })

  it('falls back to the default rather than laying out a NaN rows’ worth of balloons', () => {
    expect(clampRows(Number.NaN)).toBe(DEFAULT_CHAIN_ROWS)
    expect(clampRows(Number.POSITIVE_INFINITY)).toBe(DEFAULT_CHAIN_ROWS)
  })
})

describe('patchChainIn', () => {
  it('merges the patch into the named chain only', () => {
    const out = patchChainIn([chain('left'), chain('right')], 'left', { grow: false })
    expect(out[0].grow).toBe(false)
    expect(out[1].grow).toBe(true)
  })

  it('clamps a delay typed into the inspector', () => {
    expect(patchChainIn([chain('left')], 'left', { stepMs: 5 })[0].stepMs).toBe(CHAIN_STEP_MS.min)
  })

  it('clamps a row cap typed into the inspector', () => {
    expect(patchChainIn([chain('left')], 'left', { rows: 99 })[0].rows).toBe(CHAIN_ROWS.max)
    expect(patchChainIn([chain('left')], 'left', { rows: 0 })[0].rows).toBe(CHAIN_ROWS.min)
  })

  // The id is the join key the bubbles point at, and nothing renames one: it is generated
  // and never shown. Renaming it here would orphan every member of the chain.
  it('refuses to rename a chain', () => {
    expect(patchChainIn([chain('left')], 'left', { id: 'other' })[0].id).toBe('left')
  })

  it('is a no-op for an id that is not in the list', () => {
    const before = [chain('left')]
    expect(patchChainIn(before, 'nope', { grow: false })).toEqual(before)
  })

  it('does not mutate the input list', () => {
    const before = [chain('left', { messages: ['a'] })]
    patchChainIn(before, 'left', { messages: ['b'] })
    expect(before[0].messages).toEqual(['a'])
  })
})

describe('hydrateChains', () => {
  it('reads a persisted list back', () => {
    expect(hydrateChains([chain('left', { messages: ['hi'] })])).toEqual([
      chain('left', { messages: ['hi'] }),
    ])
  })

  // A payload written before chains existed has no `chains` key at all; syncChains
  // rebuilds the list from the bubbles, so the only thing lost is settings it never had.
  it('answers [] for anything that is not an array', () => {
    expect(hydrateChains(undefined)).toEqual([])
    expect(hydrateChains(null)).toEqual([])
    expect(hydrateChains({ left: {} })).toEqual([])
  })

  it('drops entries that are not chains rather than rejecting the whole list', () => {
    expect(hydrateChains([chain('left'), 'right', { id: 'x' }])).toEqual([chain('left')])
  })

  it('keeps the first of a duplicated id, since the list is keyed by it', () => {
    const out = hydrateChains([chain('left', { stepMs: 200 }), chain('left', { stepMs: 900 })])
    expect(out).toHaveLength(1)
    expect(out[0].stepMs).toBe(200)
  })

  it('clamps a hand-edited delay', () => {
    expect(hydrateChains([chain('left', { stepMs: 1 })])[0].stepMs).toBe(CHAIN_STEP_MS.min)
  })

  it('clamps a hand-edited row cap', () => {
    expect(hydrateChains([chain('left', { rows: 400 })])[0].rows).toBe(CHAIN_ROWS.max)
  })

  // A chain saved before the table had a row cap was a hand-drawn column of balloons. Its
  // transcript is the part worth keeping, so the cap is defaulted in rather than the whole
  // entry being read as malformed and rebuilt empty.
  it('gives an entry saved without a row cap the default, keeping its transcript', () => {
    const old: Partial<BubbleChain> = chain('left', { messages: ['hi', '> yes'] })
    delete old.rows
    expect(hydrateChains([old])).toEqual([
      chain('left', { rows: DEFAULT_CHAIN_ROWS, messages: ['hi', '> yes'] }),
    ])
  })

  it('still drops an entry whose row cap is not a number at all', () => {
    expect(hydrateChains([{ ...chain('left'), rows: 'six' }])).toEqual([])
  })
})

describe('normalizeChainId', () => {
  it('trims, so two visually identical names are one chain', () => {
    expect(normalizeChainId('  left ')).toBe('left')
  })

  it('collapses inner whitespace for the same reason', () => {
    expect(normalizeChainId('her  side')).toBe('her side')
    expect(normalizeChainId('her\tside')).toBe('her side')
  })

  it('leaves the empty "not in a chain" answer empty', () => {
    expect(normalizeChainId('   ')).toBe('')
  })
})

describe('parseMessages', () => {
  it('is one message per line, trimmed', () => {
    expect(parseMessages(' hi \nthere')).toEqual(['hi', 'there'])
  })

  it('drops blank lines — an empty balloon is not a message', () => {
    expect(parseMessages('hi\n\n  \nthere\n')).toEqual(['hi', 'there'])
  })

  it('answers [] for an empty box, which is the "speak the balloons\' own text" state', () => {
    expect(parseMessages('')).toEqual([])
    expect(parseMessages('\n\n')).toEqual([])
  })

  // A chat log is written with `>` on the sender's lines and nothing on the recipient's.
  it('reads a leading > as the sender’s side', () => {
    expect(parseMessages('hey\n> just picked up')).toEqual(['hey', `${OUT_PREFIX}just picked up`])
  })

  // Three spellings of one marker are one message, so the author never has to count spaces.
  it('normalises however the marker was spaced', () => {
    expect(parseMessages('>Yeah\n> Yeah\n>   Yeah')).toEqual([
      `${OUT_PREFIX}Yeah`,
      `${OUT_PREFIX}Yeah`,
      `${OUT_PREFIX}Yeah`,
    ])
  })

  it('drops a bare > — a marker with nothing after it is still not a message', () => {
    expect(parseMessages('hey\n>\n>  ')).toEqual(['hey'])
  })
})
