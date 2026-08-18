import { describe, expect, it } from 'vitest'

import { BUBBLE_ASPECT } from '../../skins/comic-book/bubbleShape'
import { linkedPairs } from '../../skins/comic-book/bubbleTube'
import { BUBBLE_TYPES, BUBBLE_TYPE_KEYS } from '../../skins/comic-book/editor/bubbleTypes'
import {
  PANEL_IMG_TRANSFORMS,
  PANEL_BUBBLE_TRANSFORMS,
} from '../../skins/comic-book/editor/layoutConfig'
import {
  imgTransformStyle,
  fullImgStyle,
  imgClipStyle,
  anchorToFractions,
  bubbleRect,
  bubbleStyle,
} from '../../skins/comic-book/editor/transforms'

describe('imgTransformStyle', () => {
  it('builds the expected CSS for a sample transform', () => {
    const style = imgTransformStyle({
      scale: 1.5,
      offsetX: 10,
      offsetY: -20,
      anchor: 'center bottom',
      spill: false,
    })
    expect(style.objectFit).toBe('cover')
    expect(style.objectPosition).toBe('center bottom')
    expect(style.transform).toBe('translate(10px, -20px) scale(1.5)')
    expect(style.transformOrigin).toBe('center center')
  })

  it('reproduces the identity framing at scale 1 / offset 0', () => {
    const style = imgTransformStyle({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      anchor: 'center center',
      spill: false,
    })
    expect(style.transform).toBe('translate(0px, 0px) scale(1)')
    expect(style.objectPosition).toBe('center center')
  })
})

describe('anchorToFractions', () => {
  it('maps keyword pairs to [x, y] fractions', () => {
    expect(anchorToFractions('center center')).toEqual([0.5, 0.5])
    expect(anchorToFractions('center bottom')).toEqual([0.5, 1])
    expect(anchorToFractions('left top')).toEqual([0, 0])
    expect(anchorToFractions('right bottom')).toEqual([1, 1])
  })

  it('tolerates extra whitespace and missing keywords', () => {
    expect(anchorToFractions('  right   ')).toEqual([1, 0.5])
    expect(anchorToFractions('')).toEqual([0.5, 0.5])
  })
})

describe('fullImgStyle', () => {
  const t = (over: Partial<Parameters<typeof fullImgStyle>[2]> = {}) => ({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    anchor: 'center bottom',
    spill: false,
    ...over,
  })

  it('bottom-anchors a portrait image so the cover crop still shows the bottom', () => {
    // 100×100 box, 100×200 source: cover scale 1, so the box shows the bottom 100px.
    // The full 200px-tall image is revealed above the box (top: -100).
    const s = fullImgStyle({ w: 100, h: 100 }, { w: 100, h: 200 }, t())
    expect(s.left).toBe(0)
    expect(s.top).toBe(-100)
    expect(s.width).toBe(100)
    expect(s.height).toBe(200)
    expect(s.transform).toBe('scale(1)')
    expect(s.objectFit).toBe('fill')
    // Must opt out of a global `img { max-width: 100% }` reset, else the natural
    // width collapses to the wrapper and the reveal geometry breaks.
    expect(s.maxWidth).toBe('none')
    expect(s.maxHeight).toBe('none')
  })

  it('center-anchors a wide image so it reveals symmetrically left/right', () => {
    const s = fullImgStyle({ w: 100, h: 100 }, { w: 200, h: 100 }, t({ anchor: 'center center' }))
    expect(s.left).toBe(-50)
    expect(s.top).toBe(0)
    expect(s.transform).toBe('scale(1)')
  })

  it('folds the transform zoom into the reveal scale and re-centres the pan', () => {
    const s = fullImgStyle({ w: 100, h: 100 }, { w: 100, h: 200 }, t({ scale: 2 }))
    expect(s.left).toBe(0)
    expect(s.top).toBe(-150)
    expect(s.transform).toBe('scale(2)')
  })
})

describe('imgClipStyle', () => {
  const CLIP = 'polygon(0px 0px, 10px 0px, 10px 10px, 0px 10px)'

  it('clips to the panel polygon when spill is off and not revealed', () => {
    expect(imgClipStyle(false, false, CLIP)).toEqual({
      clipPath: CLIP,
      overflow: 'hidden',
    })
  })

  it('unclips and lifts above the frame lines (z-4 > svg z-3) when spill is on', () => {
    expect(imgClipStyle(true, false, CLIP)).toEqual({
      clipPath: 'none',
      overflow: 'visible',
      zIndex: 4,
    })
  })

  it('unclips for the editor full-reveal selection regardless of spill', () => {
    expect(imgClipStyle(false, true, CLIP).clipPath).toBe('none')
    expect(imgClipStyle(true, true, CLIP).clipPath).toBe('none')
  })
})

describe('bubbleStyle', () => {
  it('maps the bubble transform to percentages and the rotation custom property', () => {
    const style = bubbleStyle({
      top: -35,
      right: -12,
      width: 55,
      rotate: -5,
      spill: true,
      type: 'soft',
      text: 'hi',
      linkTo: null,
      hoverType: null,
      clickType: null,
    }) as Record<string, string>
    expect(style.top).toBe('-35%')
    expect(style.right).toBe('-12%')
    expect(style.width).toBe('55%')
    expect(style['--cb-bubble-rot']).toBe('-5deg')
  })
})

describe('bubbleRect', () => {
  const bounds = { x: 100, y: 200, w: 400, h: 300 }
  const at = (top: number, right: number, width: number) =>
    bubbleRect(bounds, { top, right, width })

  it('sizes the box from width % of the panel and the fixed bubble aspect', () => {
    const r = at(0, 0, 50)
    expect(r.w).toBe(200)
    expect(r.h).toBeCloseTo(200 * BUBBLE_ASPECT, 10)
  })

  it('anchors by the right edge, not the left', () => {
    // right: 0 puts the bubble's right edge flush with the panel's.
    expect(at(0, 0, 50).x).toBe(bounds.x + bounds.w - 200)
  })

  it('reads top as a percentage of panel height', () => {
    expect(at(10, 0, 50).y).toBe(bounds.y + 30)
  })

  it('lets negative offsets float the bubble outside the panel', () => {
    const r = at(-35, -12, 55)
    expect(r.y).toBeLessThan(bounds.y)
    expect(r.x + r.w).toBeGreaterThan(bounds.x + bounds.w)
  })

  it('matches the default config placement for a known panel box', () => {
    const r = bubbleRect(bounds, PANEL_BUBBLE_TRANSFORMS[2])
    expect(r.w).toBeCloseTo(400 * 0.55, 10)
    expect(r.y).toBeCloseTo(200 - 300 * 0.35, 10)
  })
})

describe('BUBBLE_TYPES', () => {
  // Outlines are generated (bubbleShape.ts), so the registry only carries lettering
  // and a label now — a `src` here would mean a bubble had gone back to artwork and
  // could no longer morph.
  it('resolves a font + label for every shape the default config references', () => {
    const referenced = PANEL_BUBBLE_TRANSFORMS.flatMap(b =>
      [b.type, b.hoverType, b.clickType].filter(t => t !== null),
    )
    expect(referenced.length).toBeGreaterThan(0)
    referenced.forEach(type => {
      const def = BUBBLE_TYPES[type]
      expect(def).toBeDefined()
      expect(typeof def.font).toBe('string')
      expect(def.font.length).toBeGreaterThan(0)
      expect(typeof def.label).toBe('string')
      expect(def).not.toHaveProperty('src')
    })
  })

  it('lists every registry key in display order', () => {
    // Three shapes, not four: a "shout" balloon was the action burst redrawn a
    // shade smaller, indistinguishable in the dropdown and in the panel.
    expect(BUBBLE_TYPE_KEYS).toEqual(['soft', 'cloud', 'lightning'])
    expect(BUBBLE_TYPE_KEYS).toHaveLength(Object.keys(BUBBLE_TYPES).length)
  })
})

describe('default config parity', () => {
  it('uses center center only for the logo and center bottom for the rest', () => {
    expect(PANEL_IMG_TRANSFORMS[0].anchor).toBe('center center')
    PANEL_IMG_TRANSFORMS.slice(1).forEach(t => {
      expect(t.anchor).toBe('center bottom')
    })
  })

  it('keeps every image transform at identity framing', () => {
    PANEL_IMG_TRANSFORMS.forEach(t => {
      expect(t.scale).toBe(1)
      expect(t.offsetX).toBe(0)
      expect(t.offsetY).toBe(0)
    })
  })

  it('floats every bubble into the gutter with a caption and a rotation', () => {
    PANEL_BUBBLE_TRANSFORMS.forEach(b => {
      expect(b.spill).toBe(true)
      expect(b.rotate).toBe(-5)
      expect(b.text.length).toBeGreaterThan(0)
      expect(b.width).toBeGreaterThan(0)
    })
  })

  it('keeps the unlinked bubbles on the shared default placement', () => {
    // The two linked pairs are deliberately nudged off it so a tube has a gap to
    // span; everything else should still sit where the CSS fallback puts it.
    const nudged = new Set([0, 1, 3, 4])
    PANEL_BUBBLE_TRANSFORMS.forEach((b, i) => {
      if (nudged.has(i)) return
      expect(b.top).toBe(-35)
      expect(b.right).toBe(-12)
      expect(b.width).toBe(55)
    })
  })

  it('links two pairs, each declared from exactly one end', () => {
    expect(linkedPairs(PANEL_BUBBLE_TRANSFORMS)).toEqual([[0, 1], [3, 4]])
  })

  it('gives every bubble a hover and a click shape distinct from its resting one', () => {
    PANEL_BUBBLE_TRANSFORMS.forEach(b => {
      expect(b.hoverType).not.toBeNull()
      expect(b.clickType).not.toBeNull()
      expect(b.hoverType).not.toBe(b.type)
      expect(b.clickType).not.toBe(b.type)
    })
  })

  it('has one transform per panel (length 8)', () => {
    expect(PANEL_IMG_TRANSFORMS).toHaveLength(8)
    expect(PANEL_BUBBLE_TRANSFORMS).toHaveLength(8)
  })
})
