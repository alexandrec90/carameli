import { describe, expect, it } from 'vitest'

import {
  NEW_BUBBLE,
  NEW_CHAIN,
  addBubble,
  addChainBubble,
  cloneConfig,
  hydrateConfig,
  linkCandidates,
  patchBubble,
  patchChain,
  removeBubble,
  resetOneIn,
  seedConfig,
  setChained,
} from '../../skins/comic-book/editor/configOps'

// The chain list's place *in a config*: how it is derived from the bubbles, what a
// bubble-touching edit does to it, and how it survives a save and a reload. The list's
// own arithmetic is in editorChainOps.test.ts, and the render-time window arithmetic in
// bubbleChain.test.ts.

describe('chains in a config', () => {
  /** A config holding two bubbles on panel 6, and nothing else. */
  const twoOn6 = () => {
    const empty = { ...seedConfig(), bubbles: [] }
    const first = addBubble(empty, 6)
    return addBubble(first.config, 6)
  }

  /** The same two, linked into one column. */
  const linkedPair = () => patchBubble(twoOn6().config, 0, { linkTo: 1 })

  it('has no chains until a bubble is in one', () => {
    expect(seedConfig().chains).toEqual([])
  })

  it('grows the list the moment the box is ticked, under an id the author never types', () => {
    const cfg = setChained(twoOn6().config, 0, true)
    expect(cfg.chains).toEqual([{ id: 'chain-1', ...NEW_CHAIN }])
    expect(cfg.bubbles[0].chain).toBe('chain-1')
  })

  // The checkbox is on the thread, not on the balloon: one tick chains the column.
  it('chains every balloon in the linked group, whichever one was ticked', () => {
    const cfg = setChained(linkedPair(), 1, true)
    expect(cfg.bubbles.map(b => b.chain)).toEqual(['chain-1', 'chain-1'])
    expect(cfg.chains.map(c => c.id)).toEqual(['chain-1'])
  })

  it('leaves an already-chained group alone, so a second tick strands no settings', () => {
    let cfg = setChained(linkedPair(), 0, true)
    cfg = patchChain(cfg, 'chain-1', { messages: ['hi'] })
    cfg = setChained(cfg, 1, true)
    expect(cfg.chains).toEqual([{ id: 'chain-1', ...NEW_CHAIN, messages: ['hi'] }])
  })

  it('unticks the whole group at once, back to the balloons it was drawn as', () => {
    const cfg = setChained(setChained(linkedPair(), 0, true), 1, false)
    expect(cfg.bubbles.map(b => b.chain)).toEqual(['', ''])
    expect(cfg.chains).toEqual([])
  })

  // Linking is the only way to add a slot, so it has to pull the newcomer in by itself.
  it('adopts a balloon linked onto a chained one', () => {
    const chained = setChained(twoOn6().config, 0, true)
    expect(patchBubble(chained, 1, { linkTo: 0 }).bubbles[1].chain).toBe('chain-1')
  })

  it('keeps the tie when a slot is unlinked — a one-slot chain is a live thread’s start', () => {
    const cfg = patchBubble(setChained(linkedPair(), 0, true), 0, { linkTo: null })
    expect(cfg.bubbles.map(b => b.chain)).toEqual(['chain-1', 'chain-1'])
    expect(cfg.chains.map(c => c.id)).toEqual(['chain-1'])
  })

  it('normalises a hand-written id, so a stray space does not start a second chain', () => {
    let cfg = patchBubble(twoOn6().config, 0, { chain: ' left ' })
    cfg = patchBubble(cfg, 1, { chain: 'left' })
    expect(cfg.bubbles[0].chain).toBe('left')
    expect(cfg.chains.map(c => c.id)).toEqual(['left'])
  })

  it('drops the chain when the last member is deleted', () => {
    const cfg = setChained(twoOn6().config, 0, true)
    expect(removeBubble(cfg, 0).chains).toEqual([])
  })

  it('keeps the chain while another member is still in it', () => {
    const cfg = setChained(linkedPair(), 0, true)
    expect(removeBubble(cfg, 0).chains.map(c => c.id)).toEqual(['chain-1'])
  })

  it('re-derives the list when a reset clears a bubble’s chain', () => {
    // Bubble 6 is drawn unlinked, so resetting it takes the whole group with it.
    const cfg = setChained(seedConfig(), 6, true)
    expect(cfg.chains).toHaveLength(1)
    expect(resetOneIn(cfg, 'bubble', 6).chains).toEqual([])
  })

  it('patches a chain’s settings by id', () => {
    const cfg = patchChain(setChained(twoOn6().config, 0, true), 'chain-1', {
      grow: false,
      messages: ['one', 'two'],
    })
    expect(cfg.chains[0]).toMatchObject({ grow: false, messages: ['one', 'two'] })
  })

  it('leaves the bubbles alone when a chain is patched', () => {
    const before = setChained(twoOn6().config, 0, true)
    expect(patchChain(before, 'chain-1', { grow: false }).bubbles).toEqual(before.bubbles)
  })

  // A link on a chained pair still means "these two are one thread"; what it stops meaning
  // is "draw a tube between them" (see bubbleTube.ts). Nulling it would delete the chain's
  // own membership, which is the thing the link is now carrying.
  it('keeps the link when either end joins a chain', () => {
    const cfg = setChained(linkedPair(), 1, true)
    expect(cfg.bubbles[0].linkTo).toBe(1)
  })

  it('offers link partners to a chained bubble, since linkage is how a slot is added', () => {
    const cfg = setChained(twoOn6().config, 0, true)
    expect(linkCandidates(cfg.bubbles, 0)).toEqual([1])
    expect(linkCandidates(cfg.bubbles, 1)).toEqual([0])
  })

  it('round-trips chains through hydrateConfig', () => {
    const cfg = patchChain(setChained(twoOn6().config, 0, true), 'chain-1', {
      stepMs: 400,
      messages: ['hi'],
    })
    expect(hydrateConfig(JSON.stringify(cfg))).toEqual(cfg)
  })

  // The list is a function of the bubbles, so a payload that disagrees is repaired
  // rather than trusted — including one written before chains existed at all.
  it('rebuilds the list from the bubbles when a payload’s own list is wrong', () => {
    const cfg = setChained(twoOn6().config, 0, true)
    const saved = cloneConfig(cfg) as unknown as Record<string, unknown>
    saved.chains = [{ id: 'ghost', grow: true, stepMs: 900, messages: [] }]
    expect(hydrateConfig(JSON.stringify(saved)).chains.map(c => c.id)).toEqual(['chain-1'])
  })

  // Hand-editing a config is how a chain reaches a bubble the linkage does not: the
  // reader of a payload has to honour the linkage all the same.
  it('spreads a hand-written id across the group it was written on', () => {
    const cfg = patchBubble(linkedPair(), 1, { chain: 'left' })
    const saved = JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>
    const bubbles = saved.bubbles as { chain: string }[]
    bubbles[0].chain = ''
    expect(hydrateConfig(JSON.stringify(saved)).bubbles.map(b => b.chain)).toEqual([
      'left',
      'left',
    ])
  })

  it('rebuilds the list for a payload written before chains existed', () => {
    const saved = seedConfig() as unknown as Record<string, unknown>
    delete saved.chains
    expect(hydrateConfig(JSON.stringify(saved)).chains).toEqual([])
  })
})

describe('addChainBubble', () => {
  const withChain = () => {
    const { config, index } = addBubble({ ...seedConfig(), bubbles: [] }, 6)
    const placed = patchBubble(config, index, { top: -20, right: 5, width: 40 })
    return setChained(placed, index, true)
  }

  it('joins the new slot to the named chain on the named panel', () => {
    const { config, index } = addChainBubble(withChain(), 6, 'chain-1')
    expect(config.bubbles[index]).toMatchObject({ panel: 6, chain: 'chain-1' })
  })

  // The id is derived from the linkage, so the new slot has to be linked into the column
  // or it would be a group of its own and lose the id the moment anything reconciles.
  it('links it to the slot it was stacked on', () => {
    const { config, index } = addChainBubble(withChain(), 6, 'chain-1')
    expect(config.bubbles[index].linkTo).toBe(0)
  })

  // The column runs upward in time, so a new slot belongs above the current top one —
  // aligned with it, because a thread is a column and not a scatter.
  it('places it above the chain’s current top slot, inheriting its column', () => {
    const { config, index } = addChainBubble(withChain(), 6, 'chain-1')
    expect(config.bubbles[index].top).toBeLessThan(-20)
    expect(config.bubbles[index].right).toBe(5)
    expect(config.bubbles[index].width).toBe(40)
  })

  // Only the root speaks: it is the balloon the tail comes out of, and a stack of
  // tails would read as several people talking at once.
  it('gives it no tail', () => {
    const { config, index } = addChainBubble(withChain(), 6, 'chain-1')
    expect(config.bubbles[index].tail).toBe('none')
  })

  it('stacks each further slot above the last', () => {
    const one = addChainBubble(withChain(), 6, 'chain-1')
    const two = addChainBubble(one.config, 6, 'chain-1')
    expect(two.config.bubbles[two.index].top).toBeLessThan(one.config.bubbles[one.index].top)
    expect(two.config.bubbles[two.index].linkTo).toBe(one.index)
  })

  it('starts a chain that has no members yet at the default placement', () => {
    const { config, index } = addChainBubble({ ...seedConfig(), bubbles: [] }, 6, 'new')
    expect(config.bubbles[index]).toEqual({ ...NEW_BUBBLE, panel: 6, chain: 'new' })
    expect(config.chains.map(c => c.id)).toEqual(['new'])
  })

  it('normalises the chain id it is given', () => {
    const { config, index } = addChainBubble({ ...seedConfig(), bubbles: [] }, 6, ' new  name ')
    expect(config.bubbles[index].chain).toBe('new name')
  })

  it('does not mutate the input config', () => {
    const before = withChain()
    addChainBubble(before, 6, 'chain-1')
    expect(before.bubbles).toHaveLength(1)
  })
})
