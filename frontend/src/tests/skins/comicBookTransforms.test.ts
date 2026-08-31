import { describe, expect, it } from 'vitest'

import { BUBBLE_ASPECT, TAIL_DIR_KEYS } from '../../skins/comic-book/bubbleBox'
import { isComposerContent } from '../../skins/comic-book/bubbleChain'
import { linkedPairs } from '../../skins/comic-book/bubbleTube'
import { BUBBLE_TYPES, BUBBLE_TYPE_KEYS } from '../../skins/comic-book/editor/bubbleTypes'
import { layoutViolations, violationLines } from '../../skins/comic-book/editor/configParity'
import {
  PANEL_IMG_TRANSFORMS,
  PANEL_BUBBLE_TRANSFORMS,
  PANEL_BUBBLE_CHAINS,
} from '../../skins/comic-book/editor/layoutConfig'
import {
  imgTransformStyle,
  fullImgStyle,
  imgClipStyle,
  imgFrameBox,
  imgFrameStyle,
  imgPanelClip,
  imgVisibleRect,
  imgRect,
  renderedImgRect,
  surfaceBaseRect,
  anchorToFractions,
  bubbleRect,
  bubbleStyle,
  toClipPath,
} from '../../skins/comic-book/editor/transforms'
import type { BubbleTransform, ImgTransform } from '../../skins/comic-book/editor/types'
import { PANELS } from '../../skins/comic-book/editor/layoutConfig'

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

describe('surfaceBaseRect', () => {
  const frame = { x: 0, y: 0, w: 400, h: 300 }
  // Tall source in the wide frame: fit 0.5 → a 100×300 box, centred and flush with
  // the floor at the default center-bottom anchor.
  const nat = { w: 200, h: 600 }

  it("is the picture's rendered rect once the natural size is known", () => {
    expect(surfaceBaseRect(frame, nat, img())).toEqual(renderedImgRect(frame, nat, img()))
    expect(surfaceBaseRect(frame, nat, img())).toEqual({ x: 150, y: 0, w: 100, h: 300 })
  })

  // The whole bug this base exists to fix: the same artwork in two frames of different
  // aspect ratios letterboxes differently, so a quad measured against the frame slides
  // off the photograph on the first window resize. Measured against this rect, a quad
  // corner names the same picture pixel in both frames.
  it('pins a quad corner to the same picture pixel whatever the frame aspect', () => {
    const wide = surfaceBaseRect({ x: 0, y: 0, w: 400, h: 300 }, nat, img())
    const tall = surfaceBaseRect({ x: 0, y: 0, w: 300, h: 400 }, nat, img())
    // The base always has the artwork's own proportions — the frames do not — so a
    // percentage of it names a picture pixel, not a letterbox pixel. The frame-based
    // measure this replaced fails both lines: 400/300 and 300/400 are not 200/600.
    expect(wide.w / wide.h).toBeCloseTo(nat.w / nat.h, 10)
    expect(tall.w / tall.h).toBeCloseTo(nat.w / nat.h, 10)
    // Sanity: the two frames really do letterbox the artwork differently — pillarboxed
    // at fit 0.5 in the wide frame, at fit ⅔ in the tall one.
    expect(wide).toEqual({ x: 150, y: 0, w: 100, h: 300 })
    expect(tall.x).toBeCloseTo(250 / 3, 10)
    expect(tall.y).toBe(0)
    expect(tall.w).toBeCloseTo(400 / 3, 10)
    expect(tall.h).toBeCloseTo(400, 10)
  })

  it('stays unclamped when a pan overhangs the frame, unlike imgVisibleRect', () => {
    // offsetX 200 slides the 100-wide box to x 350..450; the frame ends at 400.
    const panned = img({ offsetX: 200 })
    expect(surfaceBaseRect(frame, nat, panned)).toEqual({ x: 350, y: 0, w: 100, h: 300 })
    expect(imgVisibleRect(frame, nat, panned)).toEqual({ x: 350, y: 0, w: 50, h: 300 })
  })

  it('falls back to the frame before the natural size is known, or on a zero frame', () => {
    expect(surfaceBaseRect(frame, undefined, img())).toEqual(frame)
    const flat = { x: 5, y: 5, w: 0, h: 300 }
    expect(surfaceBaseRect(flat, nat, img())).toEqual(flat)
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

describe('imgPanelClip', () => {
  const bounds = { x: 100, y: 200, w: 400, h: 300 }
  // A slanted quad, like the real panel polygons — the gutters are not square.
  const vp: [number, number][] = [
    [100, 200],
    [500, 220],
    [480, 500],
    [120, 480],
  ]

  // This is what keeps an unmoved picture cropping exactly as it always did: the
  // default frame is the panel box, so the wrapper sits on the panel's own origin.
  it('is the panel polygon itself at the shipped full-panel frame', () => {
    expect(imgPanelClip(vp, bounds, img())).toBe(toClipPath(vp, bounds.x, bounds.y))
  })

  // The whole point of the change: an inset frame is a rectangle of picture, windowed
  // by the panel. The polygon is *translated* into the wrapper's coordinates, never
  // scaled into the frame — scaling it is what turned a picture into a small panel.
  it('translates the panel polygon into an inset frame without scaling it', () => {
    const t = { left: 50, top: 0, width: 50, height: 50 }
    // Frame origin is (100 + 200, 200 + 0) = (300, 200).
    expect(imgPanelClip(vp, bounds, t)).toBe(
      'polygon(-200px 0px, 200px 20px, 180px 300px, -180px 280px)',
    )
  })

  // A picture whose frame is well inside the panel is not cut by the panel at all: the
  // clip's edges fall outside the wrapper, so only `overflow: hidden` on the frame bites
  // and the picture keeps its own square corners.
  it('leaves a frame clear of the panel edges uncut — no slant of its own', () => {
    const t = { left: 30, top: 30, width: 30, height: 30 }
    const clip = imgPanelClip(vp, bounds, t)
    const frame = imgRect(bounds, t)
    const pts = [...clip.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map(
      m => [Number(m[1]), Number(m[2])] as const,
    )
    expect(pts).toHaveLength(vp.length)
    // Every clip vertex lies outside the frame box, so nothing of the picture is cut.
    for (const [x, y] of pts) {
      expect(x < 0 || x > frame.w || y < 0 || y > frame.h).toBe(true)
    }
  })

  // First paint, before layout has measured anything. A NaN in a clip-path hides the
  // picture outright, so an unmeasured panel gets no clip rather than a broken one.
  it('has no window to describe against a zero-size panel box', () => {
    expect(imgPanelClip(vp, { x: 0, y: 0, w: 0, h: 300 }, img())).toBe('none')
    expect(imgPanelClip(vp, { x: 0, y: 0, w: 400, h: 0 }, img())).toBe('none')
    expect(imgPanelClip([], bounds, img())).toBe('none')
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
      hoverBold: false,
      chain: '',
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
  // A balloon whose `content` is not 'text' is a **field** drawn onto the art — a phone
  // number typed onto a photographed handset, a wheel of numbers to pick from — not a
  // line of speech. It is placed where the art puts it, points at nothing, and does not
  // morph under the pointer, so the three assertions below that describe how a *caption*
  // behaves do not apply to it.
  const isField = (b: BubbleTransform) => b.content !== 'text'

  // A balloon in a **chain** is the same exception for the same reason: it is a template
  // the live thread stamps, drawn where the conversation happens on the art rather than
  // floating in the gutter, and morphing one copy of it under the pointer would say
  // nothing about the message inside it.
  const isThread = (b: BubbleTransform) => b.chain !== ''

  // Declared first so it is the first failure read, because it is the one that says what
  // happened. Everything below pins a property of *this* layout — where the balloons sit,
  // which pairs are tubed — and reads as a broken branch when it goes red. This one asks
  // only whether the file is a finished layout at all, which is the question worth asking
  // first: the dev server rewrites `layoutConfig.ts` on every Save, so a browser tab left
  // open mid-design in any tree leaves a half-built one behind, and the next person to run
  // the suite there cannot otherwise tell it from their own work.
  it('is a finished layout — no unfinished balloons or pictures', () => {
    const violations = layoutViolations({
      images: PANEL_IMG_TRANSFORMS,
      bubbles: PANEL_BUBBLE_TRANSFORMS,
      panels: PANELS,
    })
    expect(
      violations,
      [
        'layoutConfig.ts is not a finished layout:',
        ...violationLines(violations).map(line => `  - ${line}`),
        '',
        'If you did not edit this file, this is an unsaved export from the ?edit=1 editor,',
        'left by a dev server running in this tree — not a fault in your branch. Set it',
        'aside (git stash push -- frontend/src/skins/comic-book/editor/layoutConfig.ts)',
        'rather than filling in the missing tails and morph targets by hand, which quietly',
        "overwrites somebody's in-flight design.",
      ].join('\n'),
    ).toEqual([])
  })

  it('uses center center only for the logo panels and center bottom for the rest', () => {
    // Page art only. A picture carrying a `call` role is not on the page: it stands in
    // half of a panel, framed by the author against that half, so the placement the page
    // shares has nothing to say about it — see the call layout's own assertions below.
    PANEL_IMG_TRANSFORMS.filter(t => t.call === undefined).forEach(t => {
      expect(t.anchor).toBe(PANELS[t.panel].isLogo ? 'center center' : 'center bottom')
    })
  })

  it('gives each call figure its own half, filled and unrotated', () => {
    // What `+ Call` leaves for an author to reframe: a picture over the whole of its
    // half, anchored in the middle of it rather than standing on the panel's floor. The
    // half it goes in is its role's, and the roles are what the layout switch reads.
    const figures = PANEL_IMG_TRANSFORMS.filter(t => t.call !== undefined)
    expect(figures.length).toBeGreaterThan(0)
    figures.forEach(t => {
      expect(t.anchor).toBe('center center')
      expect(t.left).toBe(0)
      expect(t.top).toBe(0)
      expect(t.width).toBe(100)
      expect(t.height).toBe(100)
    })
  })

  it('keeps every image transform at identity framing', () => {
    PANEL_IMG_TRANSFORMS.forEach(t => {
      expect(t.scale).toBe(1)
      expect(t.offsetX).toBe(0)
      expect(t.offsetY).toBe(0)
    })
  })

  // Which surface each replacement photograph carries, and that its panel and its alt
  // text name the picture that is actually in it. All three come apart together: the
  // panel names are edited in the inspector and the alt text in the picture beside it,
  // so swapping two panels' names leaves each one labelling the other's art — and a
  // screen reader then announces the notepad as a telephone.
  //
  // The corners and the text size are deliberately **not** pinned. They are what the
  // editor exists to drag: a picture reframed on the page needs its quad re-dragged onto
  // the ruling in the photograph, so a pinned corner fails on every legitimate retune and
  // teaches whoever hits it to paste the new numbers in without reading them.
  it('keeps the replacement phone and notepad bound to their matching surfaces', () => {
    const phone = PANEL_IMG_TRANSFORMS.find(t => t.src.endsWith('push-button-phone.webp'))
    const notepad = PANEL_IMG_TRANSFORMS.find(t => t.src.endsWith('hand-notepad.webp'))

    expect(phone?.alt).toBe('Push-button phone')
    expect(phone?.numberPad?.quad).toHaveLength(4)
    expect(phone?.table).toBeUndefined()
    expect(PANELS[phone!.panel].label).toBe('Phone')

    expect(notepad?.alt).toBe('Hand writing on notepad')
    expect(notepad?.table?.quad).toHaveLength(4)
    expect(notepad?.numberPad).toBeUndefined()
    expect(PANELS[notepad!.panel].label).toBe('Notepad')
  })

  // The headings the call log was asked for, pinned so that changing them is a line in a
  // diff somebody chose to write. `layoutViolations` already refuses a count that is not
  // the feed's; this is the other half — the wording, which the editor lets an author
  // change and a stale Save therefore changes silently. That is how the notepad spent
  // two PRs labelled Time/Dir/From/To with the number under 'Time' and the status art
  // under 'To'.
  it('shows the call record headings on the notepad, in the feed’s own order', () => {
    const notepad = PANEL_IMG_TRANSFORMS.find(t => t.src.endsWith('hand-notepad.webp'))
    expect(notepad?.table?.source).toBe('calls')
    expect(notepad?.table?.columns.map(c => c.label)).toEqual([
      'Number', 'Start time', 'Duration', 'Status',
    ])
  })

  // A chain's composer is the one balloon authored blank: its `text` is the field's
  // initial value (PanelBubble hands it to BubbleInput as such), and a composer that
  // opens with words in it is a message the reader did not write.
  const isComposer = (b: BubbleTransform) => isThread(b) && isComposerContent(b.content)

  // A bound chain reads the account's real thread, so its composer is the only way to
  // answer one — and the only thing that says the balloon is a field rather than
  // lettering is one word of `content`. Until this assertion the word could be changed
  // back to 'text' by any Save and nothing anywhere went red: `isComposer` was read only
  // as an *exemption* from the caption rules, which a plain caption satisfies. A chain
  // reduced to one template renders too (`chainMembers` mirrors the missing column), so
  // the page still draws — it just cannot be sent from.
  it('keeps a composer on every chain bound to the real SMS thread', () => {
    PANEL_BUBBLE_CHAINS.filter(c => c.sms).forEach(chain => {
      const members = PANEL_BUBBLE_TRANSFORMS.filter(b => b.chain === chain.id)
      expect(members.length, `chain ${chain.id} needs both its column templates`).toBe(2)
      expect(
        members.some(isComposer),
        `chain ${chain.id} is bound to the carrier but has no balloon to type into`,
      ).toBe(true)
    })
  })

  it('floats every bubble into the gutter with a caption and a rotation', () => {
    // Call balloons are exempt for the same reason their figures are: they are placed in
    // half a panel beside the figure they belong to, and a transcript is a window on
    // words the telephone supplies rather than a caption anyone authored.
    PANEL_BUBBLE_TRANSFORMS.filter(b => b.call === undefined).forEach(b => {
      expect(b.spill).toBe(true)
      expect(b.rotate).toBe(-5)
      if (!isComposer(b)) expect(b.text.length).toBeGreaterThan(0)
      expect(b.width).toBeGreaterThan(0)
    })
  })

  it('sits every call balloon square in its half, and letters only the key', () => {
    const called = PANEL_BUBBLE_TRANSFORMS.filter(b => b.call !== undefined)
    expect(called.length).toBeGreaterThan(0)
    called.forEach(b => {
      // Straight: a transcript read at an angle is harder to follow than it is charming,
      // and the red key is a photograph of a button rather than a balloon in the art.
      expect(b.rotate).toBe(0)
      expect(b.width).toBeGreaterThan(0)
      // A transcript's words come from the call, so authored text would be a second
      // source for them; the key's are its label, and `phoneAction` folds it onto a key.
      if (b.content === 'transcript') expect(b.text).toBe('')
      else expect(b.text.length).toBeGreaterThan(0)
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
      if (nudged.has(i) || isField(b) || isThread(b)) return
      expect(b.top).toBe(-35)
      expect(b.right).toBe(-12)
      expect(b.width).toBe(55)
    })
  })

  // The two caption pairs remain tubed together. The home page's telephone no longer
  // needs a third pair: `dial-call` keeps the number and its green key in one balloon.
  it('links both caption pairs, each declared from exactly one end', () => {
    expect(linkedPairs(PANEL_BUBBLE_TRANSFORMS)).toEqual([[0, 1], [4, 5]])
  })

  // Both halves of a linked *caption* pair are one speaker's line continuing, so only
  // the first carries a tail; the tube is what joins the second to it. A pair of fields
  // is not an utterance — neither end points at a speaker — so only the shared panel,
  // which is what makes a tube drawable at all, holds for every pair.
  it('gives each linked caption pair one tail between the two of them', () => {
    linkedPairs(PANEL_BUBBLE_TRANSFORMS).forEach(([i, j]) => {
      expect(PANEL_BUBBLE_TRANSFORMS[i].panel).toBe(PANEL_BUBBLE_TRANSFORMS[j].panel)
      if (isField(PANEL_BUBBLE_TRANSFORMS[i]) || isField(PANEL_BUBBLE_TRANSFORMS[j])) return
      expect(PANEL_BUBBLE_TRANSFORMS[i].tail).not.toBe('none')
      expect(PANEL_BUBBLE_TRANSFORMS[j].tail).toBe('none')
    })
  })

  it('points every other bubble’s tail somewhere', () => {
    const linked = new Set(linkedPairs(PANEL_BUBBLE_TRANSFORMS).map(([, j]) => j))
    PANEL_BUBBLE_TRANSFORMS.forEach((b, i) => {
      if (linked.has(i) || isField(b)) return
      expect(TAIL_DIR_KEYS).toContain(b.tail)
      expect(b.tail).not.toBe('none')
    })
  })

  it('gives every caption a hover and a click shape distinct from its resting one', () => {
    PANEL_BUBBLE_TRANSFORMS.filter(b => !isField(b) && !isThread(b)).forEach(b => {
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

  // `[0, 0, 100, 100]` was the compatibility guarantee from when the frame was new:
  // every picture started on its whole panel and cropped as it had before it had one.
  // Authors reframe pictures in the editor and save them out, so that guarantee is
  // spent; what has to hold of any saved frame is that it is a real box, since a zero
  // or negative extent draws nothing at all.
  it('gives every picture a frame with a real extent', () => {
    PANEL_IMG_TRANSFORMS.forEach(t => {
      expect(t.width).toBeGreaterThan(0)
      expect(t.height).toBeGreaterThan(0)
    })
  })

  // Not every panel speaks: one can carry a projected surface — a number pad, a table
  // of contacts — and say its piece that way, so the count of distinct panels named
  // here is content. What stays structural is that a balloon names a panel that exists.
  it('puts every bubble on a real panel', () => {
    PANEL_BUBBLE_TRANSFORMS.forEach(b => {
      expect(b.panel).toBeGreaterThanOrEqual(0)
      expect(b.panel).toBeLessThan(PANELS.length)
    })
  })
})
