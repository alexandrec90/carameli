import { describe, expect, it } from 'vitest'

import { CHAIN_STEP_MS, DEFAULT_CHAIN_STEP_MS } from '../../skins/comic-book/bubbleChain'
import type { BubbleChain } from '../../skins/comic-book/bubbleChain'
import {
  NEW_CHAIN,
  clampStepMs,
  cloneChain,
  hydrateChains,
  normalizeChainId,
  parseMessages,
  patchChainIn,
  syncChains,
} from '../../skins/comic-book/editor/chainOps'

const chain = (id: string, over: Partial<BubbleChain> = {}): BubbleChain => ({
  id,
  grow: true,
  scroll: true,
  stepMs: DEFAULT_CHAIN_STEP_MS,
  messages: [],
  ...over,
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
  it('creates an entry for a name that has just appeared, with both behaviours on', () => {
    const out = syncChains([{ chain: 'left' }], [])
    expect(out).toEqual([{ id: 'left', ...NEW_CHAIN }])
    expect(NEW_CHAIN.grow).toBe(true)
    expect(NEW_CHAIN.scroll).toBe(true)
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

describe('patchChainIn', () => {
  it('merges the patch into the named chain only', () => {
    const out = patchChainIn([chain('left'), chain('right')], 'left', { grow: false })
    expect(out[0].grow).toBe(false)
    expect(out[1].grow).toBe(true)
  })

  it('clamps a delay typed into the inspector', () => {
    expect(patchChainIn([chain('left')], 'left', { stepMs: 5 })[0].stepMs).toBe(CHAIN_STEP_MS.min)
  })

  // The id is the join key the bubbles point at. Renaming it here would orphan every
  // member; the rename that works is on the bubble's own `chain` field.
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
})
