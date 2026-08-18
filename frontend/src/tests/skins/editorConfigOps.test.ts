import { describe, expect, it } from 'vitest'

import {
  NEW_BUBBLE,
  addBubble,
  bubblesOnPanel,
  cloneConfig,
  hydrateConfig,
  linkCandidates,
  patchBubble,
  patchImg,
  removeBubble,
  resetOneIn,
  sanitizeLinks,
  seedConfig,
} from '../../skins/comic-book/editor/configOps'
import {
  PANEL_IMG_TRANSFORMS,
  PANEL_BUBBLE_TRANSFORMS,
} from '../../skins/comic-book/editor/layoutConfig'

/** Index of the first shipped bubble that declares a link, with its partner. */
const LINKED = PANEL_BUBBLE_TRANSFORMS.findIndex(b => b.linkTo !== null)
const LINKED_TO = PANEL_BUBBLE_TRANSFORMS[LINKED].linkTo as number

describe('seedConfig', () => {
  it('returns the constants: one image per panel, bubbles as authored', () => {
    const cfg = seedConfig()
    expect(cfg.images).toHaveLength(PANEL_IMG_TRANSFORMS.length)
    expect(cfg.images).toEqual(PANEL_IMG_TRANSFORMS)
    expect(cfg.bubbles).toEqual(PANEL_BUBBLE_TRANSFORMS)
  })

  // The two arrays parted company when a panel could own several balloons; asserting
  // they are equal-length again would re-impose the constraint this change removed.
  it('does not tie the bubble count to the panel count', () => {
    const cfg = seedConfig()
    expect(cfg.bubbles.length).toBeGreaterThan(cfg.images.length)
  })

  it('ships every bubble on a real panel', () => {
    seedConfig().bubbles.forEach(b => {
      expect(b.panel).toBeGreaterThanOrEqual(0)
      expect(b.panel).toBeLessThan(PANEL_IMG_TRANSFORMS.length)
    })
  })

  it('ships no link across two panels', () => {
    const cfg = seedConfig()
    expect(cfg.bubbles).toEqual(sanitizeLinks(cfg.bubbles))
  })

  it('deep-clones (no shared references with the constants)', () => {
    const cfg = seedConfig()
    expect(cfg.images[0]).not.toBe(PANEL_IMG_TRANSFORMS[0])
    expect(cfg.bubbles[0]).not.toBe(PANEL_BUBBLE_TRANSFORMS[0])
    cfg.images[0].scale = 99
    expect(PANEL_IMG_TRANSFORMS[0].scale).toBe(1)
  })
})

describe('cloneConfig', () => {
  it('produces an independent deep copy', () => {
    const a = seedConfig()
    const b = cloneConfig(a)
    expect(b).toEqual(a)
    b.bubbles[2].top = -100
    expect(a.bubbles[2].top).not.toBe(-100)
  })
})

describe('sanitizeLinks', () => {
  const at = (panel: number, linkTo: number | null) => ({ ...NEW_BUBBLE, panel, linkTo })

  it('keeps a link between two bubbles on one panel', () => {
    const kept = sanitizeLinks([at(2, 1), at(2, null)])
    expect(kept[0].linkTo).toBe(1)
  })

  it('drops a link whose ends are on different panels', () => {
    expect(sanitizeLinks([at(2, 1), at(3, null)])[0].linkTo).toBeNull()
  })

  it('drops a self-link and an out-of-range index', () => {
    const cleaned = sanitizeLinks([at(0, 0), at(0, 9)])
    expect(cleaned.map(b => b.linkTo)).toEqual([null, null])
  })

  it('leaves unlinked bubbles untouched, references included', () => {
    const input = [at(0, null)]
    expect(sanitizeLinks(input)[0]).toBe(input[0])
  })
})

describe('hydrateConfig', () => {
  it('falls back to seed for null', () => {
    expect(hydrateConfig(null)).toEqual(seedConfig())
  })

  it('round-trips a serialized seed config', () => {
    const seed = seedConfig()
    expect(hydrateConfig(JSON.stringify(seed))).toEqual(seed)
  })

  it('round-trips a mutated config', () => {
    const cfg = patchImg(seedConfig(), 3, { scale: 1.4, offsetY: -12 })
    expect(hydrateConfig(JSON.stringify(cfg))).toEqual(cfg)
  })

  it('falls back to seed on malformed JSON without throwing', () => {
    expect(() => hydrateConfig('not json')).not.toThrow()
    expect(hydrateConfig('not json')).toEqual(seedConfig())
  })

  it('falls back to seed on structurally invalid payloads', () => {
    expect(hydrateConfig('{}')).toEqual(seedConfig())
    expect(hydrateConfig(JSON.stringify({ images: [], bubbles: [] }))).toEqual(seedConfig())
    expect(hydrateConfig(JSON.stringify({ images: [1, 2, 3] }))).toEqual(seedConfig())
  })

  // The author's bubble count is data now, so a payload with more or fewer than the
  // seed is valid rather than corrupt — rejecting it would discard their work.
  it('keeps a bubble array of any length', () => {
    const cfg = addBubble(seedConfig(), 5).config
    expect(hydrateConfig(JSON.stringify(cfg)).bubbles).toHaveLength(cfg.bubbles.length)
    expect(hydrateConfig(JSON.stringify({ ...cfg, bubbles: [] })).bubbles).toEqual([])
  })

  it('backfills fields missing from an older payload (pre-panel/tail)', () => {
    const legacy = {
      images: PANEL_IMG_TRANSFORMS.map(({ scale, offsetX, offsetY, anchor }) => ({
        scale,
        offsetX,
        offsetY,
        anchor,
      })),
      bubbles: [{ top: 10, right: 20, width: 30, rotate: 0 }],
    }
    const cfg = hydrateConfig(JSON.stringify(legacy))
    expect(cfg.images).toEqual(PANEL_IMG_TRANSFORMS)
    expect(cfg.bubbles).toEqual([
      { ...NEW_BUBBLE, panel: 0, top: 10, right: 20, width: 30, rotate: 0 },
    ])
  })

  it('clamps a panel index that outruns the panel list', () => {
    const raw = JSON.stringify({
      images: PANEL_IMG_TRANSFORMS,
      bubbles: [{ ...NEW_BUBBLE, panel: 99 }, { ...NEW_BUBBLE, panel: -4 }],
    })
    expect(hydrateConfig(raw).bubbles.map(b => b.panel)).toEqual([
      PANEL_IMG_TRANSFORMS.length - 1,
      0,
    ])
  })

  it('drops a cross-panel link a hand-edited payload smuggled in', () => {
    const raw = JSON.stringify({
      images: PANEL_IMG_TRANSFORMS,
      bubbles: [{ ...NEW_BUBBLE, panel: 0, linkTo: 1 }, { ...NEW_BUBBLE, panel: 1 }],
    })
    expect(hydrateConfig(raw).bubbles[0].linkTo).toBeNull()
  })
})

describe('patchImg / patchBubble', () => {
  it('patch-merges an image entry and leaves others untouched', () => {
    const next = patchImg(seedConfig(), 1, { scale: 2 })
    expect(next.images[1]).toEqual({ ...PANEL_IMG_TRANSFORMS[1], scale: 2 })
    expect(next.images[0]).toEqual(PANEL_IMG_TRANSFORMS[0])
  })

  it('patch-merges a bubble entry and leaves others untouched', () => {
    const next = patchBubble(seedConfig(), 4, { rotate: 12, width: 60 })
    expect(next.bubbles[4]).toEqual({ ...PANEL_BUBBLE_TRANSFORMS[4], rotate: 12, width: 60 })
    expect(next.bubbles[0]).toEqual(PANEL_BUBBLE_TRANSFORMS[0])
  })

  it('changes which panel a bubble belongs to', () => {
    expect(patchBubble(seedConfig(), 2, { panel: 6 }).bubbles[2].panel).toBe(6)
  })

  it('changes the tail direction, "none" included', () => {
    expect(patchBubble(seedConfig(), 2, { tail: 'up-right' }).bubbles[2].tail).toBe('up-right')
    expect(patchBubble(seedConfig(), 0, { tail: 'none' }).bubbles[0].tail).toBe('none')
  })

  // Moving one end of a linked pair away is the edit that strands a tube.
  it('drops the link when a patch moves a bubble off its partner’s panel', () => {
    const moved = patchBubble(seedConfig(), LINKED_TO, { panel: 7 })
    expect(moved.bubbles[LINKED].linkTo).toBeNull()
  })

  it('does not mutate the input config', () => {
    const base = seedConfig()
    patchImg(base, 0, { scale: 5 })
    patchBubble(base, 0, { panel: 7 })
    expect(base.images[0].scale).toBe(1)
    expect(base.bubbles[0].panel).toBe(PANEL_BUBBLE_TRANSFORMS[0].panel)
  })

  it('is a no-op for an out-of-range index', () => {
    const base = seedConfig()
    expect(patchImg(base, 99, { scale: 5 })).toEqual(base)
    expect(patchBubble(base, 99, { rotate: 5 })).toEqual(base)
  })
})

describe('addBubble', () => {
  it('appends a default bubble on the requested panel and reports its index', () => {
    const before = seedConfig()
    const { config, index } = addBubble(before, 6)
    expect(index).toBe(before.bubbles.length)
    expect(config.bubbles).toHaveLength(before.bubbles.length + 1)
    expect(config.bubbles[index]).toEqual({ ...NEW_BUBBLE, panel: 6 })
  })

  it('starts the new bubble unlinked, so it never joins a stranger', () => {
    const { config, index } = addBubble(seedConfig(), 0)
    expect(config.bubbles[index].linkTo).toBeNull()
  })

  it('leaves the existing bubbles and their links alone', () => {
    const before = seedConfig()
    const { config } = addBubble(before, 3)
    expect(config.bubbles.slice(0, before.bubbles.length)).toEqual(before.bubbles)
  })

  it('does not mutate the input config', () => {
    const before = seedConfig()
    addBubble(before, 2)
    expect(before.bubbles).toHaveLength(PANEL_BUBBLE_TRANSFORMS.length)
  })

  it('lets one panel own several bubbles', () => {
    const { config } = addBubble(addBubble(seedConfig(), 6).config, 6)
    expect(bubblesOnPanel(config.bubbles, 6).length).toBeGreaterThanOrEqual(2)
  })
})

describe('removeBubble', () => {
  it('drops the bubble and shortens the array', () => {
    const before = seedConfig()
    const after = removeBubble(before, 2)
    expect(after.bubbles).toHaveLength(before.bubbles.length - 1)
    expect(after.bubbles[2]).toEqual(before.bubbles[3])
  })

  // A link names a bubble, not a slot: leaving the raw indices would silently
  // re-point every later link at its neighbour.
  it('renumbers the links that sat after the deleted bubble', () => {
    const before = seedConfig()
    const after = removeBubble(before, 0)
    before.bubbles.forEach((b, i) => {
      if (i === 0 || b.linkTo === null || b.linkTo === 0) return
      // The surviving link still names the same balloon, at its new index.
      const moved = after.bubbles[i - 1]
      expect(moved.linkTo).not.toBeNull()
      expect(after.bubbles[moved.linkTo!]).toEqual(before.bubbles[b.linkTo])
    })
  })

  it('nulls a link whose partner was the deleted bubble', () => {
    const after = removeBubble(seedConfig(), LINKED_TO)
    expect(after.bubbles[LINKED].linkTo).toBeNull()
  })

  it('nulls a link declared at the other end when its partner goes', () => {
    const mutual = patchBubble(seedConfig(), LINKED_TO, { linkTo: LINKED })
    const after = removeBubble(mutual, LINKED)
    expect(after.bubbles[LINKED].linkTo).toBeNull()
  })

  it('is a no-op for an out-of-range index', () => {
    const base = seedConfig()
    expect(removeBubble(base, 99)).toEqual(base)
  })

  it('does not mutate the input config', () => {
    const base = seedConfig()
    removeBubble(base, 0)
    expect(base.bubbles).toHaveLength(PANEL_BUBBLE_TRANSFORMS.length)
  })
})

describe('resetOneIn', () => {
  it('restores a single image entry to its default', () => {
    const edited = patchImg(seedConfig(), 2, { scale: 3, offsetX: 50 })
    expect(resetOneIn(edited, 'img', 2).images[2]).toEqual(PANEL_IMG_TRANSFORMS[2])
  })

  it('restores a single bubble entry to its default', () => {
    const edited = patchBubble(seedConfig(), 5, { top: 0, rotate: 30 })
    expect(resetOneIn(edited, 'bubble', 5).bubbles[5]).toEqual(PANEL_BUBBLE_TRANSFORMS[5])
  })

  it('leaves sibling entries of the same kind alone', () => {
    let cfg = patchImg(seedConfig(), 1, { scale: 2 })
    cfg = patchImg(cfg, 2, { scale: 3 })
    const reset = resetOneIn(cfg, 'img', 1)
    expect(reset.images[1]).toEqual(PANEL_IMG_TRANSFORMS[1])
    expect(reset.images[2].scale).toBe(3)
  })

  // An added bubble has no shipped default to go back to; deleting it is the delete
  // button's job, and silently dropping it here would read as reset losing work.
  it('leaves a bubble the author added in place', () => {
    const { config, index } = addBubble(seedConfig(), 4)
    const edited = patchBubble(config, index, { rotate: 40 })
    expect(resetOneIn(edited, 'bubble', index).bubbles[index].rotate).toBe(40)
  })
})

describe('bubblesOnPanel / linkCandidates', () => {
  it('lists a panel’s bubbles in array order', () => {
    const cfg = seedConfig()
    const own = bubblesOnPanel(cfg.bubbles, cfg.bubbles[LINKED].panel)
    expect(own).toContain(LINKED)
    expect(own).toEqual([...own].sort((a, b) => a - b))
  })

  it('is empty for a panel with no bubbles', () => {
    expect(bubblesOnPanel([], 0)).toEqual([])
  })

  // The same-panel rule is enforced by never offering the invalid choice.
  it('offers only same-panel partners, and never the bubble itself', () => {
    const cfg = seedConfig()
    const options = linkCandidates(cfg.bubbles, LINKED)
    expect(options).not.toContain(LINKED)
    expect(options).toContain(LINKED_TO)
    options.forEach(i => expect(cfg.bubbles[i].panel).toBe(cfg.bubbles[LINKED].panel))
  })

  it('offers nothing when a bubble is alone on its panel', () => {
    const { config, index } = addBubble({ ...seedConfig(), bubbles: [] }, 6)
    expect(linkCandidates(config.bubbles, index)).toEqual([])
  })

  it('offers the new partner as soon as one joins the panel', () => {
    const first = addBubble({ ...seedConfig(), bubbles: [] }, 6)
    const second = addBubble(first.config, 6)
    expect(linkCandidates(second.config.bubbles, first.index)).toEqual([second.index])
    expect(linkCandidates(second.config.bubbles, second.index)).toEqual([first.index])
  })

  it('is empty for an index with no bubble', () => {
    expect(linkCandidates(seedConfig().bubbles, 99)).toEqual([])
  })
})
