import { describe, expect, it } from 'vitest'

import { BUBBLE_ASPECT, TAIL_DIR_KEYS } from '../../skins/comic-book/bubbleBox'
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
  imgFrameBox,
  imgFramePoints,
  imgFramePoly,
  imgFrameStyle,
  imgRect,
  anchorToFractions,
  bubbleRect,
  bubbleStyle,
  toClipPath,
} from '../../skins/comic-book/editor/transforms'
import type { ImgTransform } from '../../skins/comic-book/editor/types'
import { PANELS } from '../../skins/comic-book/panels'

/** A picture at the shipped default: full-panel frame, identity framing inside it. */
const img = (over: Partial<ImgTransform> = {}): ImgTransform => ({
  panel: 0,
  src: '/comic-book/logo.webp',
  alt: 'Carameli',
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  anchor: 'center bottom',
  spill: false,
  ...over,
})

describe('imgTransformStyle', () => {
  it('builds the expected CSS for a sample transform', () => {
    const style = imgTransformStyle(img({ scale: 1.5, offsetX: 10, offsetY: -20 }))
    expect(style.objectFit).toBe('cover')
    expect(style.objectPosition).toBe('center bottom')
    expect(style.transform).toBe('translate(10px, -20px) scale(1.5)')
    expect(style.transformOrigin).toBe('center center')
  })

  it('reproduces the identity framing at scale 1 / offset 0', () => {
    const style = imgTransformStyle(img({ anchor: 'center center' }))
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
  // `bounds` here is the *frame* box, not the panel box — an inset picture covers its
  // own frame, which is the whole point of the frame being the picture's.
  const t = img

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

// ─── The picture's own frame ─────────────────────────────────────────────────────
// A picture used to borrow its panel's polygon as its window, so dragging one could
// only slide the picture underneath a window that never moved. These four functions
// are the frame that replaced that, and they all have to agree: when the box you can
// drag and the box that gets drawn disagree, the picture moves somewhere you didn't
// click.

describe('imgFrameBox / imgRect / imgFrameStyle', () => {
  const bounds = { x: 100, y: 200, w: 400, h: 300 }

  it('reads the frame as percentages of the panel box', () => {
    expect(imgFrameBox(bounds, { left: 25, top: 10, width: 50, height: 40 })).toEqual({
      x: 100,
      y: 30,
      w: 200,
      h: 120,
    })
  })

  it('is the whole panel box at the shipped default', () => {
    expect(imgFrameBox(bounds, img())).toEqual({ x: 0, y: 0, w: 400, h: 300 })
    expect(imgRect(bounds, img())).toEqual(bounds)
  })

  // Negative and past-100 are how a picture hangs off an edge into the gutter, so
  // neither function may clamp — the frame is allowed to leave the panel.
  it('lets the frame hang off the panel in either direction', () => {
    const box = imgFrameBox(bounds, { left: -25, top: -10, width: 150, height: 120 })
    expect(box).toEqual({ x: -100, y: -30, w: 600, h: 360 })
  })

  it('imgRect is imgFrameBox offset into viewport coordinates', () => {
    const t = { left: 25, top: 10, width: 50, height: 40 }
    const box = imgFrameBox(bounds, t)
    expect(imgRect(bounds, t)).toEqual({
      x: bounds.x + box.x,
      y: bounds.y + box.y,
      w: box.w,
      h: box.h,
    })
  })

  // The wrapper is absolutely positioned inside the panel element, which already sits
  // at the panel's bounds — so it takes the panel-relative box, not the viewport one.
  it('imgFrameStyle places the wrapper on the panel-relative box', () => {
    const t = { left: 25, top: 10, width: 50, height: 40 }
    expect(imgFrameStyle(bounds, t)).toEqual({
      position: 'absolute',
      left: 100,
      top: 30,
      width: 200,
      height: 120,
    })
  })
})

describe('imgFramePoints / imgFramePoly', () => {
  const bounds = { x: 100, y: 200, w: 400, h: 300 }
  // A slanted quad, like the real panel polygons — the gutters are not square.
  const vp: [number, number][] = [
    [100, 200],
    [500, 220],
    [480, 500],
    [120, 480],
  ]

  // This is what keeps an unmoved picture cropping exactly as it always did: the
  // default frame is the panel, so the frame's shape is the panel's shape.
  it('is the panel polygon itself at the shipped full-panel frame', () => {
    expect(imgFramePoints(vp, bounds, img())).toEqual(vp)
    expect(imgFramePoly(vp, bounds, img())).toBe(toClipPath(vp, bounds.x, bounds.y))
  })

  // Taking the panel's shape rather than a plain rectangle is what keeps this a comic:
  // an inset picture reads as a smaller panel, with the same slant as the grid around it.
  it('scales that same shape into an inset frame', () => {
    const t = { left: 50, top: 0, width: 50, height: 50 }
    expect(imgFramePoints(vp, bounds, t)).toEqual([
      [300, 200],
      [500, 210],
      [490, 350],
      [310, 340],
    ])
  })

  it('keeps the slant when a frame is inset — it is not squared off to a rectangle', () => {
    const pts = imgFramePoints(vp, bounds, { left: 20, top: 20, width: 55, height: 55 })
    expect(pts[0][1]).not.toBe(pts[1][1]) // top edge still slopes
    expect(pts[0][0]).not.toBe(pts[3][0]) // left edge still leans
  })

  it('emits the clip relative to the frame, so the shape lands on the picture', () => {
    const t = { left: 50, top: 0, width: 50, height: 50 }
    expect(imgFramePoly(vp, bounds, t)).toBe(
      'polygon(0px 0px, 200px 10px, 190px 150px, 10px 140px)',
    )
  })

  // First paint, before layout has measured anything. Scaling a shape into a zero-size
  // box is a division by zero, and a NaN in a clip-path hides the picture outright.
  it('has no shape to scale against a zero-size panel box', () => {
    expect(imgFramePoints(vp, { x: 0, y: 0, w: 0, h: 300 }, img())).toEqual([])
    expect(imgFramePoints(vp, { x: 0, y: 0, w: 400, h: 0 }, img())).toEqual([])
    expect(imgFramePoly(vp, { x: 0, y: 0, w: 0, h: 0 }, img())).toBe('none')
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
      panel: 0,
      top: -35,
      right: -12,
      width: 55,
      rotate: -5,
      spill: true,
      type: 'soft',
      tail: 'down-left',
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

  it('keeps the bubbles that are alone on their panel on the shared placement', () => {
    // The two linked pairs are deliberately nudged off it so a tube has a gap to
    // span; everything else should still sit where the CSS fallback puts it.
    // Panel 4's bubble is nudged too — it is the one panel whose art reaches the
    // top-right corner the default placement floats into.
    const second = linkedPairs(PANEL_BUBBLE_TRANSFORMS).map(([, j]) => j)
    const nudged = new Set([...second, 6])
    PANEL_BUBBLE_TRANSFORMS.forEach((b, i) => {
      if (nudged.has(i)) return
      expect(b.top).toBe(-35)
      expect(b.right).toBe(-12)
      expect(b.width).toBe(55)
    })
  })

  it('links two pairs, each declared from exactly one end', () => {
    expect(linkedPairs(PANEL_BUBBLE_TRANSFORMS)).toEqual([[0, 1], [4, 5]])
  })

  // Both halves of a linked pair are one speaker's line continuing, so only the first
  // carries a tail; the tube is what joins the second to it.
  it('gives each linked pair one tail between the two of them', () => {
    linkedPairs(PANEL_BUBBLE_TRANSFORMS).forEach(([i, j]) => {
      expect(PANEL_BUBBLE_TRANSFORMS[i].panel).toBe(PANEL_BUBBLE_TRANSFORMS[j].panel)
      expect(PANEL_BUBBLE_TRANSFORMS[i].tail).not.toBe('none')
      expect(PANEL_BUBBLE_TRANSFORMS[j].tail).toBe('none')
    })
  })

  it('points every other bubble’s tail somewhere', () => {
    const linked = new Set(linkedPairs(PANEL_BUBBLE_TRANSFORMS).map(([, j]) => j))
    PANEL_BUBBLE_TRANSFORMS.forEach((b, i) => {
      if (linked.has(i)) return
      expect(TAIL_DIR_KEYS).toContain(b.tail)
      expect(b.tail).not.toBe('none')
    })
  })

  it('gives every bubble a hover and a click shape distinct from its resting one', () => {
    PANEL_BUBBLE_TRANSFORMS.forEach(b => {
      expect(b.hoverType).not.toBeNull()
      expect(b.clickType).not.toBeNull()
      expect(b.hoverType).not.toBe(b.type)
      expect(b.clickType).not.toBe(b.type)
    })
  })

  // Neither array is parallel to the panels any more: each entry names its own panel,
  // so only the panel it names has to be real. The shipped page happens to draw one
  // picture per panel, and that is data — asserting the two lengths match would
  // re-impose the constraint this change removed.
  it('puts every picture on a real panel, and draws every panel once', () => {
    const panels = PANEL_IMG_TRANSFORMS.map(t => t.panel)
    panels.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(PANELS.length)
    })
    expect(new Set(panels).size).toBe(PANELS.length)
  })

  it('gives every picture a file of its own and alt text', () => {
    const files = PANEL_IMG_TRANSFORMS.map(t => t.src)
    expect(new Set(files).size).toBe(files.length)
    PANEL_IMG_TRANSFORMS.forEach(t => {
      expect(t.src.startsWith('/comic-book/')).toBe(true)
      expect(t.alt.length).toBeGreaterThan(0)
    })
  })

  // The frame is new, so the shipped values are the compatibility guarantee: every
  // picture starts on its whole panel and crops exactly as it did before it had one.
  it('starts every picture on the full-panel frame', () => {
    PANEL_IMG_TRANSFORMS.forEach(t => {
      expect([t.left, t.top, t.width, t.height]).toEqual([0, 0, 100, 100])
    })
  })

  it('puts every bubble on a real panel, and every panel speaks at least once', () => {
    const panels = PANEL_BUBBLE_TRANSFORMS.map(b => b.panel)
    panels.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(PANELS.length)
    })
    expect(new Set(panels).size).toBe(PANELS.length)
    expect(PANEL_BUBBLE_TRANSFORMS.length).toBeGreaterThan(PANELS.length)
  })
})
