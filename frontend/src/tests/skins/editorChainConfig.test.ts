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

  it('has no chains until a bubble names one', () => {
    expect(seedConfig().chains).toEqual([])
  })

  it('grows the list the moment a name is typed on a bubble', () => {
    const cfg = patchBubble(twoOn6().config, 0, { chain: 'left' })
    expect(cfg.chains).toEqual([{ id: 'left', ...NEW_CHAIN }])
  })

  it('normalises the typed name, so a stray space does not start a second chain', () => {
    let cfg = patchBubble(twoOn6().config, 0, { chain: ' left ' })
    cfg = patchBubble(cfg, 1, { chain: 'left' })
    expect(cfg.bubbles[0].chain).toBe('left')
    expect(cfg.chains.map(c => c.id)).toEqual(['left'])
  })

  it('drops the chain again when the last member leaves it', () => {
    let cfg = patchBubble(twoOn6().config, 0, { chain: 'left' })
    cfg = patchBubble(cfg, 0, { chain: '' })
    expect(cfg.chains).toEqual([])
  })

  it('drops the chain when the last member is deleted', () => {
    const cfg = patchBubble(twoOn6().config, 0, { chain: 'left' })
    expect(removeBubble(cfg, 0).chains).toEqual([])
  })

  it('keeps the chain while another member is still in it', () => {
    let cfg = patchBubble(twoOn6().config, 0, { chain: 'left' })
    cfg = patchBubble(cfg, 1, { chain: 'left' })
    expect(removeBubble(cfg, 0).chains.map(c => c.id)).toEqual(['left'])
  })

  it('re-derives the list when a reset clears a bubble’s chain', () => {
    const cfg = patchBubble(seedConfig(), 5, { chain: 'left' })
    expect(resetOneIn(cfg, 'bubble', 5).chains).toEqual([])
  })

  it('patches a chain’s settings by name', () => {
    const cfg = patchChain(patchBubble(twoOn6().config, 0, { chain: 'left' }), 'left', {
      grow: false,
      messages: ['one', 'two'],
    })
    expect(cfg.chains[0]).toMatchObject({ grow: false, messages: ['one', 'two'] })
  })

  it('leaves the bubbles alone when a chain is patched', () => {
    const before = patchBubble(twoOn6().config, 0, { chain: 'left' })
    expect(patchChain(before, 'left', { scroll: false }).bubbles).toEqual(before.bubbles)
  })

  // A tube welds two fixed balloons together. A chained slot holds whatever message has
  // scrolled into it, so the same tube would join a different sentence each time.
  it('drops a tube the moment either end joins a chain', () => {
    const linked = patchBubble(twoOn6().config, 0, { linkTo: 1 })
    expect(linked.bubbles[0].linkTo).toBe(1)
    expect(patchBubble(linked, 1, { chain: 'left' }).bubbles[0].linkTo).toBeNull()
  })

  it('offers no link partners to a chained bubble, and never offers one', () => {
    const cfg = patchBubble(twoOn6().config, 0, { chain: 'left' })
    expect(linkCandidates(cfg.bubbles, 0)).toEqual([])
    expect(linkCandidates(cfg.bubbles, 1)).toEqual([])
  })

  it('round-trips chains through hydrateConfig', () => {
    const cfg = patchChain(patchBubble(twoOn6().config, 0, { chain: 'left' }), 'left', {
      stepMs: 400,
      messages: ['hi'],
    })
    expect(hydrateConfig(JSON.stringify(cfg))).toEqual(cfg)
  })

  // The list is a function of the bubbles, so a payload that disagrees is repaired
  // rather than trusted — including one written before chains existed at all.
  it('rebuilds the list from the bubbles when a payload’s own list is wrong', () => {
    const cfg = patchBubble(twoOn6().config, 0, { chain: 'left' })
    const saved = cloneConfig(cfg) as unknown as Record<string, unknown>
    saved.chains = [{ id: 'ghost', grow: true, scroll: true, stepMs: 900, messages: [] }]
    expect(hydrateConfig(JSON.stringify(saved)).chains.map(c => c.id)).toEqual(['left'])
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
    return patchBubble(config, index, { chain: 'left', top: -20, right: 5, width: 40 })
  }

  it('joins the new slot to the named chain on the named panel', () => {
    const { config, index } = addChainBubble(withChain(), 6, 'left')
    expect(config.bubbles[index]).toMatchObject({ panel: 6, chain: 'left' })
  })

  // The column runs upward in time, so a new slot belongs above the current top one —
  // aligned with it, because a thread is a column and not a scatter.
  it('places it above the chain’s current top slot, inheriting its column', () => {
    const { config, index } = addChainBubble(withChain(), 6, 'left')
    expect(config.bubbles[index].top).toBeLessThan(-20)
    expect(config.bubbles[index].right).toBe(5)
    expect(config.bubbles[index].width).toBe(40)
  })

  // Only the root speaks: it is the balloon the tail comes out of, and a stack of
  // tails would read as several people talking at once.
  it('gives it no tail', () => {
    const { config, index } = addChainBubble(withChain(), 6, 'left')
    expect(config.bubbles[index].tail).toBe('none')
  })

  it('stacks each further slot above the last', () => {
    const one = addChainBubble(withChain(), 6, 'left')
    const two = addChainBubble(one.config, 6, 'left')
    expect(two.config.bubbles[two.index].top).toBeLessThan(one.config.bubbles[one.index].top)
  })

  it('starts a chain that has no members yet at the default placement', () => {
    const { config, index } = addChainBubble({ ...seedConfig(), bubbles: [] }, 6, 'new')
    expect(config.bubbles[index]).toEqual({ ...NEW_BUBBLE, panel: 6, chain: 'new' })
    expect(config.chains.map(c => c.id)).toEqual(['new'])
  })

  it('normalises the chain name it is given', () => {
    const { config, index } = addChainBubble({ ...seedConfig(), bubbles: [] }, 6, ' new  name ')
    expect(config.bubbles[index].chain).toBe('new name')
  })

  it('does not mutate the input config', () => {
    const before = withChain()
    addChainBubble(before, 6, 'left')
    expect(before.bubbles).toHaveLength(1)
  })
})
