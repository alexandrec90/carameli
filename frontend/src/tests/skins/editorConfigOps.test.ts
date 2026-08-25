import { describe, expect, it } from 'vitest'

import {
  NEW_BUBBLE,
  NEW_IMAGE,
  addBubble,
  addImg,
  cloneConfig,
  hydrateConfig,
  indicesOnPanel,
  linkCandidates,
  patchBubble,
  patchImg,
  removeBubble,
  removeImg,
  resetGrid,
  resetOneIn,
  sanitizeLinks,
  seedConfig,
  setGrid,
} from '../../skins/comic-book/editor/configOps'
import {
  BUBBLE_TYPE_KEYS,
  isBubbleType,
} from '../../skins/comic-book/editor/bubbleTypes'
import {
  PANEL_GRIDS,
  PANEL_IMG_TRANSFORMS,
  PANEL_BUBBLE_TRANSFORMS,
} from '../../skins/comic-book/editor/layoutConfig'
import {
  RING_POINTS,
  TAIL_DIR_KEYS,
  cloudPuffs,
  isTailDir,
} from '../../skins/comic-book/bubbleBox'
import { puffOpacity, ringPoints } from '../../skins/comic-book/bubbleShape'
import { PANELS } from '../../skins/comic-book/panels'

/** Index of the first shipped bubble that declares a link, with its partner. */
const LINKED = PANEL_BUBBLE_TRANSFORMS.findIndex(b => b.linkTo !== null)
const LINKED_TO = PANEL_BUBBLE_TRANSFORMS[LINKED].linkTo as number

describe('seedConfig', () => {
  it('returns the constants verbatim, both arrays as authored', () => {
    const cfg = seedConfig()
    expect(cfg.images).toEqual(PANEL_IMG_TRANSFORMS)
    expect(cfg.bubbles).toEqual(PANEL_BUBBLE_TRANSFORMS)
  })

  // Pictures stopped being parallel to the panels at the same time bubbles did; the
  // shipped config happens to hold one each, and that is data, not a constraint.
  it('ships every picture on a real panel', () => {
    seedConfig().images.forEach(t => {
      expect(t.panel).toBeGreaterThanOrEqual(0)
      expect(t.panel).toBeLessThan(PANELS.length)
      expect(t.src.length).toBeGreaterThan(0)
    })
  })

  it('ships every picture on the default full-panel frame', () => {
    seedConfig().images.forEach(t => {
      expect([t.left, t.top, t.width, t.height]).toEqual([0, 0, 100, 100])
    })
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
      expect(b.panel).toBeLessThan(PANELS.length)
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
    expect(hydrateConfig(JSON.stringify({ images: [1, 2, 3] }))).toEqual(seedConfig())
    expect(hydrateConfig(JSON.stringify({ bubbles: [] }))).toEqual(seedConfig())
  })

  // An author who deleted everything gets an empty page back, not the shipped one:
  // two arrays that are both present and both arrays is a valid document, and
  // re-seeding here would make "delete all" impossible to persist. The grids come
  // back seeded even so — there is no gesture that empties a page of its panels, so
  // a payload without them is one written before they existed, not one cleared.
  it('keeps a payload that deliberately holds nothing', () => {
    expect(hydrateConfig(JSON.stringify({ images: [], bubbles: [] }))).toEqual({
      images: [],
      bubbles: [],
      grids: seedConfig().grids,
    })
  })

  // The author's bubble count is data now, so a payload with more or fewer than the
  // seed is valid rather than corrupt — rejecting it would discard their work.
  it('keeps a bubble array of any length', () => {
    const cfg = addBubble(seedConfig(), 5).config
    expect(hydrateConfig(JSON.stringify(cfg)).bubbles).toHaveLength(cfg.bubbles.length)
    expect(hydrateConfig(JSON.stringify({ ...cfg, bubbles: [] })).bubbles).toEqual([])
  })

  // The pre-entity payload: pictures were parallel to the panels and carried only their
  // framing, so `panel`, `src`, `alt` and the whole frame have to come back from the
  // seed entry at the same index. Recovering them from NEW_IMAGE instead would turn
  // every picture on the page into the logo.
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

  it('keeps whatever framing the older payload had already changed', () => {
    const legacy = {
      images: [{ scale: 2, offsetX: 30, offsetY: -10, anchor: 'left top' }],
      bubbles: [],
    }
    expect(hydrateConfig(JSON.stringify(legacy)).images).toEqual([
      { ...PANEL_IMG_TRANSFORMS[0], scale: 2, offsetX: 30, offsetY: -10, anchor: 'left top' },
    ])
  })

  // Past the seed's length there is no shipped identity to recover, so the template is
  // the whole answer — a ninth picture must not read back as undefined fields.
  it('falls back to the new-picture template beyond the shipped entries', () => {
    const cfg = seedConfig()
    const raw = JSON.stringify({
      images: [...cfg.images, { panel: 3, left: 10, top: 10 }],
      bubbles: cfg.bubbles,
    })
    const ninth = hydrateConfig(raw).images[cfg.images.length]
    expect(ninth).toEqual({ ...NEW_IMAGE, panel: 3, left: 10, top: 10 })
  })

  it('keeps an image array of any length', () => {
    const cfg = addImg(seedConfig(), 2).config
    expect(hydrateConfig(JSON.stringify(cfg)).images).toHaveLength(cfg.images.length)
    expect(hydrateConfig(JSON.stringify({ ...cfg, images: [] })).images).toEqual([])
  })

  it('clamps a picture’s panel index the same way it clamps a bubble’s', () => {
    const raw = JSON.stringify({
      images: [{ ...NEW_IMAGE, panel: 99 }, { ...NEW_IMAGE, panel: -4 }],
      bubbles: [],
    })
    expect(hydrateConfig(raw).images.map(t => t.panel)).toEqual([PANELS.length - 1, 0])
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

  // The registries shrink. `jagged` was a fourth bubble type, and a working copy saved
  // while it existed went on naming it — through a hydrate that casts the payload into
  // BubbleTransform rather than checking it — until `SHAPES['jagged']` came back
  // undefined and `ringPoints` threw on the destructure, blanking the whole page.
  // Everything below is that payload, one retired name at a time.
  it('replaces a retired resting type with the plain ellipse', () => {
    const raw = JSON.stringify({
      images: [],
      bubbles: [{ ...NEW_BUBBLE, type: 'jagged', text: 'KA-POW!' }],
    })
    const [b] = hydrateConfig(raw).bubbles
    expect(b.type).toBe('soft')
    // The one dead attribute goes; the author's words and framing stay.
    expect(b.text).toBe('KA-POW!')
    expect(b.width).toBe(NEW_BUBBLE.width)
  })

  it('clears a retired hover or click morph target rather than resting it', () => {
    const raw = JSON.stringify({
      images: [],
      bubbles: [{ ...NEW_BUBBLE, hoverType: 'jagged', clickType: 'cloud' }],
    })
    const [b] = hydrateConfig(raw).bubbles
    // null already spells "stay as you are" — the bubble stops morphing on hover and
    // keeps the click morph it still has.
    expect(b.hoverType).toBeNull()
    expect(b.clickType).toBe('cloud')
  })

  it('replaces a retired tail direction with no tail', () => {
    const raw = JSON.stringify({
      images: [],
      bubbles: [{ ...NEW_BUBBLE, tail: 'sideways' }],
    })
    expect(hydrateConfig(raw).bubbles[0].tail).toBe('none')
  })

  // A working copy saved before the wheel picker existed has no `content` field at
  // all; the NEW_BUBBLE merge backfills it as plain text.
  it('backfills a pre-wheel bubble as plain text', () => {
    const preWheel: Record<string, unknown> = { ...NEW_BUBBLE, text: 'Number please!' }
    delete preWheel.content
    const raw = JSON.stringify({ images: [], bubbles: [preWheel] })
    const [b] = hydrateConfig(raw).bubbles
    expect(b.content).toBe('text')
    expect(b.text).toBe('Number please!')
  })

  it('replaces a retired content kind with plain text', () => {
    const raw = JSON.stringify({
      images: [],
      bubbles: [{ ...NEW_BUBBLE, content: 'spinner', text: 'One, Two' }],
    })
    const [b] = hydrateConfig(raw).bubbles
    // The words are still there, just lettered plainly rather than on a wheel.
    expect(b.content).toBe('text')
    expect(b.text).toBe('One, Two')
  })

  it('leaves every live type and direction exactly as authored', () => {
    const bubbles = BUBBLE_TYPE_KEYS.flatMap(type =>
      TAIL_DIR_KEYS.map(tail => ({ ...NEW_BUBBLE, panel: 0, type, tail, hoverType: type })),
    )
    expect(hydrateConfig(JSON.stringify({ images: [], bubbles })).bubbles).toEqual(bubbles)
  })

  // The reversion check: this is the assertion that fails if the coercion is removed,
  // because it exercises the crash itself rather than the field it comes from.
  it('yields bubbles every renderer can draw without throwing', () => {
    const raw = JSON.stringify({
      images: [],
      bubbles: [{ ...NEW_BUBBLE, type: 'jagged', hoverType: 'jagged', tail: 'sideways' }],
    })
    for (const b of hydrateConfig(raw).bubbles) {
      expect(() => ringPoints(b.type, b.tail)).not.toThrow()
      expect(() => puffOpacity(b.type)).not.toThrow()
      expect(() => cloudPuffs(b.tail)).not.toThrow()
      expect(ringPoints(b.type, b.tail)).toHaveLength(RING_POINTS * 2)
    }
  })
})

describe('isBubbleType / isTailDir', () => {
  it('accepts exactly the registered names', () => {
    BUBBLE_TYPE_KEYS.forEach(k => expect(isBubbleType(k)).toBe(true))
    TAIL_DIR_KEYS.forEach(k => expect(isTailDir(k)).toBe(true))
  })

  it('rejects a retired name, a non-string, and an inherited property', () => {
    expect(isBubbleType('jagged')).toBe(false)
    expect(isBubbleType(null)).toBe(false)
    expect(isBubbleType(undefined)).toBe(false)
    expect(isTailDir('sideways')).toBe(false)
    expect(isTailDir(3)).toBe(false)
    // `in` would say yes to these; the own-property check is why the guard does not.
    expect(isBubbleType('toString')).toBe(false)
    expect(isTailDir('constructor')).toBe(false)
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

  it('moves a picture to another panel, and swaps which file it draws', () => {
    const moved = patchImg(seedConfig(), 2, { panel: 5, src: '/comic-book/rolodex.webp' })
    expect(moved.images[2].panel).toBe(5)
    expect(moved.images[2].src).toBe('/comic-book/rolodex.webp')
    // The other picture on panel 5 is untouched: two may share one now.
    expect(moved.images[5]).toEqual(PANEL_IMG_TRANSFORMS[5])
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

describe('addImg', () => {
  it('appends a default picture on the requested panel and reports its index', () => {
    const before = seedConfig()
    const { config, index } = addImg(before, 6)
    expect(index).toBe(before.images.length)
    expect(config.images).toHaveLength(before.images.length + 1)
    expect(config.images[index]).toEqual({ ...NEW_IMAGE, panel: 6 })
  })

  // A second picture added at the full-panel frame would land exactly on the one
  // already there, and adding it would read as nothing having happened.
  it('starts the new picture inset, not covering the panel', () => {
    const { config, index } = addImg(seedConfig(), 0)
    const t = config.images[index]
    expect([t.left, t.top]).not.toEqual([0, 0])
    expect(t.width).toBeLessThan(100)
    expect(t.height).toBeLessThan(100)
  })

  it('leaves the existing pictures alone', () => {
    const before = seedConfig()
    const { config } = addImg(before, 3)
    expect(config.images.slice(0, before.images.length)).toEqual(before.images)
  })

  it('does not mutate the input config', () => {
    const before = seedConfig()
    addImg(before, 2)
    expect(before.images).toHaveLength(PANEL_IMG_TRANSFORMS.length)
  })

  it('lets one panel own several pictures', () => {
    const { config } = addImg(addImg(seedConfig(), 6).config, 6)
    expect(indicesOnPanel(config.images, 6).length).toBeGreaterThanOrEqual(3)
  })
})

describe('removeImg', () => {
  it('drops the picture and shortens the array', () => {
    const before = seedConfig()
    const after = removeImg(before, 2)
    expect(after.images).toHaveLength(before.images.length - 1)
    expect(after.images[2]).toEqual(before.images[3])
  })

  // Nothing points at a picture by index the way a bubble's `linkTo` points at a
  // bubble, so deleting one must not disturb the bubbles at all.
  it('leaves the bubbles and their links untouched', () => {
    const before = seedConfig()
    expect(removeImg(before, 0).bubbles).toEqual(before.bubbles)
  })

  it('is a no-op for an out-of-range index', () => {
    const base = seedConfig()
    expect(removeImg(base, 99)).toEqual(base)
  })

  it('does not mutate the input config', () => {
    const base = seedConfig()
    removeImg(base, 0)
    expect(base.images).toHaveLength(PANEL_IMG_TRANSFORMS.length)
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
    expect(indicesOnPanel(config.bubbles, 6).length).toBeGreaterThanOrEqual(2)
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

  it('leaves a picture the author added in place', () => {
    const { config, index } = addImg(seedConfig(), 4)
    const edited = patchImg(config, index, { width: 12 })
    expect(resetOneIn(edited, 'img', index).images[index].width).toBe(12)
  })

  // Reset is what undoes a frame drag, which is the gesture the whole change is about.
  it('restores a dragged frame, not just the framing inside it', () => {
    const edited = patchImg(seedConfig(), 2, { left: 40, top: -15, width: 30, height: 30 })
    expect(resetOneIn(edited, 'img', 2).images[2]).toEqual(PANEL_IMG_TRANSFORMS[2])
  })
})

describe('indicesOnPanel / linkCandidates', () => {
  it('lists a panel’s bubbles in array order', () => {
    const cfg = seedConfig()
    const own = indicesOnPanel(cfg.bubbles, cfg.bubbles[LINKED].panel)
    expect(own).toContain(LINKED)
    expect(own).toEqual([...own].sort((a, b) => a - b))
  })

  it('is empty for a panel with nothing on it', () => {
    expect(indicesOnPanel([], 0)).toEqual([])
    expect(indicesOnPanel(seedConfig().bubbles, 99)).toEqual([])
  })

  // `panel` is the only field it reads, which is what lets one function answer the
  // question for both arrays — the inspector's per-panel counts use it on each.
  it('reads the picture array on the same terms as the bubble array', () => {
    const cfg = addImg(seedConfig(), 6).config
    expect(indicesOnPanel(cfg.images, 6)).toEqual([6, cfg.images.length - 1])
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

describe('grids in a config', () => {
  it('seeds all three, deep-cloned from the constants', () => {
    const cfg = seedConfig()
    expect(Object.keys(cfg.grids).sort()).toEqual(['landscape', 'portrait', 'square'])
    cfg.grids.landscape.vertices[0][0] = 0.5
    cfg.grids.landscape.panels[0].push(99)
    // The constant is untouched: a shallow copy would have handed every working config
    // the same vertex table, and the first drag would have edited the shipped file.
    expect(PANEL_GRIDS.landscape.vertices[0]).toEqual([0, 0])
    expect(seedConfig().grids.landscape.panels[0]).toEqual(PANEL_GRIDS.landscape.panels[0])
  })

  it('is deep-cloned by cloneConfig too', () => {
    const cfg = seedConfig()
    const copy = cloneConfig(cfg)
    copy.grids.square.vertices[1][1] = 0.42
    expect(cfg.grids.square.vertices[1][1]).not.toBe(0.42)
  })

  it('setGrid replaces one breakpoint and leaves the other two alone', () => {
    const cfg = seedConfig()
    const edited = setGrid(cfg, 'portrait', {
      vertices: [[0, 0], [1, 0], [1, 1], [0, 1]],
      panels: [[0, 1, 2, 3]],
    })
    expect(edited.grids.portrait.panels).toHaveLength(1)
    expect(edited.grids.landscape).toEqual(cfg.grids.landscape)
    expect(edited.grids.square).toEqual(cfg.grids.square)
    expect(cfg.grids.portrait).toEqual(PANEL_GRIDS.portrait)
  })

  it('resetGrid restores one breakpoint without undoing the others', () => {
    let cfg = setGrid(seedConfig(), 'portrait', { vertices: [[0, 0]], panels: [[0]] })
    cfg = setGrid(cfg, 'square', { vertices: [[0, 0]], panels: [[0]] })
    const back = resetGrid(cfg, 'portrait')
    expect(back.grids.portrait).toEqual(PANEL_GRIDS.portrait)
    expect(back.grids.square.panels).toEqual([[0]])
  })
})

describe('hydrateConfig grids', () => {
  it('keeps a saved grid that is structurally sound', () => {
    const saved = setGrid(seedConfig(), 'landscape', {
      ...PANEL_GRIDS.landscape,
      vertices: PANEL_GRIDS.landscape.vertices.map(([x, y], i) => (i === 2 ? [0.4, 0.4] : [x, y])),
    })
    const back = hydrateConfig(JSON.stringify(saved))
    expect(back.grids.landscape.vertices[2]).toEqual([0.4, 0.4])
  })

  /*
   * A subdivision is taken whole or not at all: a ring naming a vertex that is not in
   * the table cannot be repaired into a page, only into a differently broken one. The
   * author's pictures and words survive around the shipped grids.
   */
  it('falls back to the shipped grids when a saved one is broken, keeping the rest', () => {
    const saved = patchImg(seedConfig(), 0, { left: 12.5 }) as unknown as Record<string, unknown>
    saved.grids = { landscape: { vertices: [[0, 0]], panels: [[0, 7]] } }
    const back = hydrateConfig(JSON.stringify(saved))
    expect(back.grids).toEqual(seedConfig().grids)
    expect(back.images[0].left).toBe(12.5)
  })

  it('falls back for a payload written before grids existed', () => {
    const saved = seedConfig() as unknown as Record<string, unknown>
    delete saved.grids
    expect(hydrateConfig(JSON.stringify(saved)).grids).toEqual(seedConfig().grids)
  })
})
