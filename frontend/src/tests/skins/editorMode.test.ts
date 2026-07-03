import { describe, expect, it } from 'vitest'

import {
  PANEL_IMG_TRANSFORMS,
  PANEL_BUBBLE_TRANSFORMS,
} from '../../skins/comic-book/editor/layoutConfig'
import {
  cloneConfig,
  hydrateConfig,
  patchBubble,
  patchImg,
  resetOneIn,
  seedConfig,
  shouldRevealImg,
} from '../../skins/comic-book/editor/useEditorMode'

describe('seedConfig', () => {
  it('returns length-8 arrays equal to the constants', () => {
    const cfg = seedConfig()
    expect(cfg.images).toHaveLength(8)
    expect(cfg.bubbles).toHaveLength(8)
    expect(cfg.images).toEqual(PANEL_IMG_TRANSFORMS)
    expect(cfg.bubbles).toEqual(PANEL_BUBBLE_TRANSFORMS)
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

  it('backfills fields missing from an older payload (pre-spill/type/text)', () => {
    // Simulate a config persisted before spill/type/text existed: strip them out.
    const legacy = {
      images: PANEL_IMG_TRANSFORMS.map(({ scale, offsetX, offsetY, anchor }) => ({
        scale,
        offsetX,
        offsetY,
        anchor,
      })),
      bubbles: PANEL_BUBBLE_TRANSFORMS.map(({ top, right, width, rotate }) => ({
        top,
        right,
        width,
        rotate,
      })),
    }
    // Equals the current seed once the new fields are filled in from defaults.
    expect(hydrateConfig(JSON.stringify(legacy))).toEqual(seedConfig())
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

  it('does not mutate the input config', () => {
    const base = seedConfig()
    patchImg(base, 0, { scale: 5 })
    expect(base.images[0].scale).toBe(1)
  })

  it('is a no-op for an out-of-range index', () => {
    const base = seedConfig()
    expect(patchImg(base, 99, { scale: 5 })).toEqual(base)
  })
})

describe('shouldRevealImg', () => {
  it('reveals only the selected image panel', () => {
    const selected = { kind: 'img', index: 3 } as const
    expect(shouldRevealImg(true, selected, 3)).toBe(true)
    expect(shouldRevealImg(true, selected, 2)).toBe(false)
  })

  it('does not reveal when the editor is inactive', () => {
    expect(shouldRevealImg(false, { kind: 'img', index: 3 }, 3)).toBe(false)
  })

  it('does not reveal when nothing is selected', () => {
    expect(shouldRevealImg(true, null, 0)).toBe(false)
  })

  it('does not reveal when a bubble (not the image) is selected', () => {
    expect(shouldRevealImg(true, { kind: 'bubble', index: 3 }, 3)).toBe(false)
  })
})

describe('resetOneIn', () => {
  it('restores a single image entry to its default', () => {
    const edited = patchImg(seedConfig(), 2, { scale: 3, offsetX: 50 })
    const reset = resetOneIn(edited, 'img', 2)
    expect(reset.images[2]).toEqual(PANEL_IMG_TRANSFORMS[2])
  })

  it('restores a single bubble entry to its default', () => {
    const edited = patchBubble(seedConfig(), 5, { top: 0, rotate: 30 })
    const reset = resetOneIn(edited, 'bubble', 5)
    expect(reset.bubbles[5]).toEqual(PANEL_BUBBLE_TRANSFORMS[5])
  })

  it('leaves sibling entries of the same kind alone', () => {
    let cfg = patchImg(seedConfig(), 1, { scale: 2 })
    cfg = patchImg(cfg, 2, { scale: 3 })
    const reset = resetOneIn(cfg, 'img', 1)
    expect(reset.images[1]).toEqual(PANEL_IMG_TRANSFORMS[1])
    expect(reset.images[2].scale).toBe(3)
  })
})
