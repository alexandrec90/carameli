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
  isFullPanelFrame,
  imgVisibleRect,
  imgRect,
  renderedImgRect,
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
    expect(style.objectFit).toBe('contain')
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
  // `bounds` here is the *frame* box, not the panel box — an inset picture fits its
  // own frame, which is the whole point of the frame being the picture's.
  const t = img

  /** The box the image actually occupies once the transform's scale is applied. */
  const renderedRect = (s: ReturnType<typeof fullImgStyle>, nw: number, nh: number) => {
    const m = /scale\(([^)]+)\)/.exec(String(s.transform))
    const k = m ? Number(m[1]) : NaN
    const cx = Number(s.left) + nw / 2
    const cy = Number(s.top) + nh / 2
    return {
      left: cx - (nw * k) / 2,
      top: cy - (nh * k) / 2,
      right: cx + (nw * k) / 2,
      bottom: cy + (nh * k) / 2,
    }
  }

  it('contains a portrait image whole, resting on the frame floor when bottom-anchored', () => {
    // 100×100 box, 100×200 source: contain scale 0.5, so the full image renders
    // 50×100 on the bottom edge. left/top place the natural-size img so the scaled
    // box lands there (top: -50 because the 200px img shrinks about its centre).
    const s = fullImgStyle({ w: 100, h: 100 }, { w: 100, h: 200 }, t())
    expect(s.left).toBe(0)
    expect(s.top).toBe(-50)
    expect(s.width).toBe(100)
    expect(s.height).toBe(200)
    expect(s.transform).toBe('scale(0.5)')
    expect(s.objectFit).toBe('fill')
    // Must opt out of a global `img { max-width: 100% }` reset, else the natural
    // width collapses to the wrapper and the reveal geometry breaks.
    expect(s.maxWidth).toBe('none')
    expect(s.maxHeight).toBe('none')
    expect(renderedRect(s, 100, 200)).toEqual({ left: 25, top: 0, right: 75, bottom: 100 })
  })

  it('centers a wide image with symmetric margins left and right', () => {
    const s = fullImgStyle({ w: 100, h: 100 }, { w: 200, h: 100 }, t({ anchor: 'center center' }))
    expect(s.left).toBe(-50)
    expect(s.top).toBe(0)
    expect(s.transform).toBe('scale(0.5)')
    expect(renderedRect(s, 200, 100)).toEqual({ left: 0, top: 25, right: 100, bottom: 75 })
  })

  it('folds the transform zoom into the reveal scale and re-centres the pan', () => {
    // scale 2 on the 0.5 contain fit is scale(1) — a deliberate zoom past the frame
    // is still exactly what the editor's slider promises.
    const s = fullImgStyle({ w: 100, h: 100 }, { w: 100, h: 200 }, t({ scale: 2 }))
    expect(s.left).toBe(0)
    expect(s.top).toBe(-50)
    expect(s.transform).toBe('scale(1)')
  })

  // Regression for the beheaded receptionist: her 1671×1487 art, cover-fitted into
  // a ~714×281 panel, rendered 354px above the frame, so the panel's ink line cut
  // across her face. At scale 1 nothing may leave the frame — the artwork's own
  // edges are the borders the reader sees, whatever the two aspect ratios are.
  it('keeps the whole image inside the frame at scale 1, whatever the aspects', () => {
    const boxes = [
      { w: 714, h: 281, nw: 1671, nh: 1487 }, // wide panel, tall art (the receptionist)
      { w: 281, h: 714, nw: 2816, nh: 1536 }, // tall panel, wide art
    ]
    const anchors = ['center bottom', 'center center', 'left top']
    boxes.forEach(({ w, h, nw, nh }) => {
      anchors.forEach(anchor => {
        const s = fullImgStyle({ w, h }, { w: nw, h: nh }, t({ anchor }))
        const r = renderedRect(s, nw, nh)
        expect(r.left).toBeGreaterThanOrEqual(-1e-6)
        expect(r.top).toBeGreaterThanOrEqual(-1e-6)
        expect(r.right).toBeLessThanOrEqual(w + 1e-6)
        expect(r.bottom).toBeLessThanOrEqual(h + 1e-6)
      })
    })
  })
})

describe('renderedImgRect', () => {
  const frame = { x: 10, y: 20, w: 100, h: 100 }

  it('is the contain-fit box resting on the anchor at identity', () => {
    // 100×200 source in a 100×100 frame: fit 0.5 → a 50×100 box, centred
    // horizontally and flush with the frame floor at the default center bottom.
    expect(renderedImgRect(frame, { w: 100, h: 200 }, img())).toEqual({
      x: 35,
      y: 20,
      w: 50,
      h: 100,
    })
  })

  it('agrees with fullImgStyle about where the pixels land', () => {
    // Same geometry engine underneath — recomputed here from the style so a change
    // to either path that moves the picture away from its border fails this.
    const t = img({ scale: 1.4, offsetX: 7, offsetY: -3, anchor: 'left top' })
    const nat = { w: 300, h: 180 }
    const s = fullImgStyle({ w: frame.w, h: frame.h }, nat, t)
    const m = /scale\(([^)]+)\)/.exec(String(s.transform))
    const k = m ? Number(m[1]) : NaN
    const r = renderedImgRect(frame, nat, t)
    expect(r.x + r.w / 2).toBeCloseTo(frame.x + Number(s.left) + nat.w / 2, 10)
    expect(r.y + r.h / 2).toBeCloseTo(frame.y + Number(s.top) + nat.h / 2, 10)
    expect(r.w).toBeCloseTo(nat.w * k, 10)
    expect(r.h).toBeCloseTo(nat.h * k, 10)
  })
})

describe('imgVisibleRect', () => {
  const bounds = { x: 100, y: 200, w: 400, h: 300 }
  // Tall source in the wide full-panel frame: fit 0.5 → a 100×300 box, centred
  // and flush with the floor — x 250..350, y 200..500.
  const nat = { w: 200, h: 600 }
  const frame = { x: 100, y: 200, w: 400, h: 300 }

  it("is the image's own rectangle, not the panel frame, at identity", () => {
    expect(imgVisibleRect(bounds, nat, img())).toEqual({ x: 250, y: 200, w: 100, h: 300 })
  })

  it('falls back to the frame before the natural size is known', () => {
    expect(imgVisibleRect(bounds, undefined, img())).toEqual(frame)
  })

  it('falls back to the frame once a zoom crops past every edge', () => {
    // scale 4 renders 400×1200 over the 400×300 frame — a filled, deliberate crop,
    // so the frame is the only edge the picture visibly has.
    expect(imgVisibleRect(bounds, nat, img({ scale: 4 }))).toEqual(frame)
  })

  it('clamps to the frame when a pan pushes one edge out', () => {
    // offsetX 200 slides the 100-wide box to x 450..550; the frame ends at 500.
    expect(imgVisibleRect(bounds, nat, img({ offsetX: 200 }))).toEqual({
      x: 450,
      y: 200,
      w: 50,
      h: 300,
    })
  })

  it('falls back to the frame when the picture is panned fully outside it', () => {
    expect(imgVisibleRect(bounds, nat, img({ offsetX: 600 }))).toEqual(frame)
  })

  it('returns the degenerate frame against a zero-size panel box', () => {
    expect(imgVisibleRect({ x: 0, y: 0, w: 0, h: 300 }, nat, img())).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 300,
    })
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

describe('isFullPanelFrame', () => {
  it('recognizes only the identity frame that duplicates the panel outline', () => {
    expect(isFullPanelFrame(img())).toBe(true)
    expect(isFullPanelFrame(img({ width: 99.9 }))).toBe(false)
    expect(isFullPanelFrame(img({ left: 1 }))).toBe(false)
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
      content: 'text',
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
  it('uses center center only for the logo panels and center bottom for the rest', () => {
    PANEL_IMG_TRANSFORMS.forEach(t => {
      expect(t.anchor).toBe(PANELS[t.panel].isLogo ? 'center center' : 'center bottom')
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
