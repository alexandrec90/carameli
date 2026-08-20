import { describe, expect, it } from 'vitest'

import { BUBBLE_ASPECT, TAIL_DIR_KEYS } from '../../skins/comic-book/bubbleBox'
import { linkedPairs } from '../../skins/comic-book/bubbleTube'
import { BUBBLE_TYPES, BUBBLE_TYPE_KEYS } from '../../skins/comic-book/editor/bubbleTypes'
import {
  PANEL_IMG_TRANSFORMS,
  PANEL_BUBBLE_TRANSFORMS,
} from '../../skins/comic-book/editor/layoutConfig'
import {
  IMG_ASPECT_FALLBACK,
  imgAspect,
  imgClipStyle,
  imgFillStyle,
  imgFrameBox,
  imgFrameStyle,
  imgPanelClip,
  imgRect,
  bubbleRect,
  bubbleStyle,
  toClipPath,
} from '../../skins/comic-book/editor/transforms'
import type { ImgTransform } from '../../skins/comic-book/editor/types'
import { PANELS } from '../../skins/comic-book/panels'

/** A picture whose frame spans the full width of its panel box, at the panel's origin. */
const img = (over: Partial<ImgTransform> = {}): ImgTransform => ({
  panel: 0,
  src: '/comic-book/logo.webp',
  alt: 'Carameli',
  left: 0,
  top: 0,
  width: 100,
  spill: false,
  ...over,
})

/** Aspect of the 400x300 panel box the geometry tests below use. */
const PANEL_ASPECT = 4 / 3

describe('imgAspect', () => {
  it('is the source ratio once the picture has loaded', () => {
    expect(imgAspect({ w: 800, h: 400 })).toBe(2)
    expect(imgAspect({ w: 300, h: 600 })).toBe(0.5)
  })

  // The page stays behind its loading sheet until every picture settles, so the
  // fallback is never seen — but a frame with no shape at all would divide by zero.
  it('falls back to square before the source is known, and on a degenerate one', () => {
    expect(imgAspect(undefined)).toBe(IMG_ASPECT_FALLBACK)
    expect(imgAspect({ w: 0, h: 400 })).toBe(IMG_ASPECT_FALLBACK)
    expect(imgAspect({ w: 800, h: 0 })).toBe(IMG_ASPECT_FALLBACK)
  })
})

describe('imgFillStyle', () => {
  // No cover crop, no object-position, no transform. The frame was built to this
  // source's ratio, so filling it *is* drawing the whole picture at true proportions —
  // and there is nothing left able to choose which part of it survives.
  it('fills the frame and nothing else', () => {
    const s = imgFillStyle()
    expect(s).toEqual({
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      maxWidth: 'none',
      maxHeight: 'none',
      objectFit: 'contain',
    })
  })

  // A global `img { max-width: 100% }` reset would otherwise shrink an enlarged
  // picture back to its source width, and the frame would stop being its outline.
  it('opts out of the max-width reset', () => {
    expect(imgFillStyle().maxWidth).toBe('none')
    expect(imgFillStyle().maxHeight).toBe('none')
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

  it('reads left/top/width as percentages of the panel box', () => {
    const box = imgFrameBox(bounds, { left: 25, top: 10, width: 50 }, 2)
    expect(box).toEqual({ x: 100, y: 30, w: 200, h: 100 })
  })

  // The guarantee the whole change exists for: the height is never authored, so the
  // box is always the source's own shape and the outline the editor draws around a
  // picture is the picture's outline. Three panels' worth of ratios, one rule.
  it('always derives the height from the source ratio, never from the panel', () => {
    for (const aspect of [0.5, 1, 1.5, PANEL_ASPECT, 3.2]) {
      for (const width of [12, 55, 100, 180]) {
        const box = imgFrameBox(bounds, { left: 0, top: 0, width }, aspect)
        expect(box.w / box.h).toBeCloseTo(aspect, 10)
      }
    }
  })

  it('covers the panel box exactly when the source shares its ratio', () => {
    expect(imgFrameBox(bounds, img(), PANEL_ASPECT)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
    expect(imgRect(bounds, img(), PANEL_ASPECT)).toEqual(bounds)
  })

  // A tall source at the same width is taller than the panel, and is *not* squashed
  // into it — the overhang is the panel's to crop, per `spill`.
  it('overhangs the panel rather than being squashed into it', () => {
    expect(imgFrameBox(bounds, img(), 1).h).toBe(400)
  })

  // Square, so the shape is defined, and never seen: the page waits behind its
  // loading sheet. It matters only that this cannot divide by zero.
  it('falls back to a square frame for an unmeasured source', () => {
    const box = imgFrameBox(bounds, { left: 0, top: 0, width: 50 }, 0)
    expect(box.w).toBe(box.h)
  })

  // Negative and past-100 are how a picture hangs off an edge into the gutter, so
  // neither function may clamp — the frame is allowed to leave the panel.
  it('lets the frame hang off the panel in either direction', () => {
    const box = imgFrameBox(bounds, { left: -25, top: -10, width: 150 }, 2)
    expect(box).toEqual({ x: -100, y: -30, w: 600, h: 300 })
  })

  it('imgRect is imgFrameBox offset into viewport coordinates', () => {
    const t = { left: 25, top: 10, width: 50 }
    const box = imgFrameBox(bounds, t, 2)
    expect(imgRect(bounds, t, 2)).toEqual({
      x: bounds.x + box.x,
      y: bounds.y + box.y,
      w: box.w,
      h: box.h,
    })
  })

  // The wrapper is absolutely positioned inside the panel element, which already sits
  // at the panel's bounds — so it takes the panel-relative box, not the viewport one.
  it('imgFrameStyle places the wrapper on the panel-relative box', () => {
    expect(imgFrameStyle(bounds, { left: 25, top: 10, width: 50 }, 2)).toEqual({
      position: 'absolute',
      left: 100,
      top: 30,
      width: 200,
      height: 100,
    })
  })

  // The renderer places the wrapper and the overlay outlines it. Handed the same
  // aspect they must agree to the pixel, or the selection box is around thin air.
  it('draws the wrapper on exactly the box the overlay outlines', () => {
    const t = { left: 25, top: 10, width: 50 }
    const style = imgFrameStyle(bounds, t, 0.75)
    const rect = imgRect(bounds, t, 0.75)
    expect([style.left, style.top]).toEqual([rect.x - bounds.x, rect.y - bounds.y])
    expect([style.width, style.height]).toEqual([rect.w, rect.h])
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

  // The crop is the panel, at the panel's own size, wherever the frame happens to be:
  // the same shape a non-spilling bubble is cut to. Only the origin moves, because the
  // clip lands on the frame element rather than on the panel.
  it('is the panel polygon itself when the frame covers the panel box', () => {
    expect(imgPanelClip(vp, bounds, img(), 4 / 3)).toBe(toClipPath(vp, bounds.x, bounds.y))
  })

  it('re-origins that same shape onto an inset frame, without shrinking it', () => {
    const t = { left: 50, top: 0, width: 50 }
    expect(imgPanelClip(vp, bounds, t, 1)).toBe(
      'polygon(-200px 0px, 200px 20px, 180px 300px, -180px 280px)',
    )
  })

  // The Mailman 2 bug. The crop used to be the panel's shape *scaled into the frame*, so
  // a frame wider than its panel dragged the crop out with it and the picture reached
  // into the gutter with `spill` unchecked. At the panel's true size it cannot.
  it('does not grow with a frame that overhangs its panel', () => {
    const xs = (clip: string) =>
      [...clip.matchAll(/(-?\d+(?:\.\d+)?)px (-?\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]))
    const span = (clip: string) => Math.max(...xs(clip)) - Math.min(...xs(clip))
    const wide = imgPanelClip(vp, bounds, { left: -25, top: -25, width: 150 }, 1)
    expect(span(wide)).toBe(span(imgPanelClip(vp, bounds, img(), 1)))
  })

  // First paint, before layout has measured anything: there is no panel shape to cut
  // with yet, and an empty polygon() would hide the picture outright.
  it('has no shape to cut with before the panel is measured', () => {
    expect(imgPanelClip([], bounds, img(), 1)).toBe('none')
  })
})

describe('imgClipStyle', () => {
  const CLIP = 'polygon(0px 0px, 10px 0px, 10px 10px, 0px 10px)'

  it('clips to the panel polygon when spill is off', () => {
    expect(imgClipStyle(false, CLIP)).toEqual({
      clipPath: CLIP,
      overflow: 'hidden',
    })
  })

  it('unclips and lifts above the frame lines (z-4 > svg z-3) when spill is on', () => {
    expect(imgClipStyle(true, CLIP)).toEqual({
      clipPath: 'none',
      overflow: 'hidden',
      zIndex: 4,
    })
  })

  // The frame is how big the picture renders, and that holds however `spill` is set: the
  // img inside is laid out at full source geometry, so an overflow that could be lifted
  // is a picture overhanging the outline the editor draws around it.
  it('never lets the picture escape its own frame', () => {
    expect(imgClipStyle(false, CLIP).overflow).toBe('hidden')
    expect(imgClipStyle(true, CLIP).overflow).toBe('hidden')
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

  // A picture is placed by three numbers and nothing else. A fourth — any authored
  // height — is what let a frame be a shape the source is not, and every such shape
  // but one crops: the eight shipped pictures showed between 38% and 98% of their
  // source before this, no two framed alike. Reading extra keys off the config is how
  // that comes back, so assert the exact key set rather than only the three values.
  it('places every picture by frame position and width alone', () => {
    PANEL_IMG_TRANSFORMS.forEach(t => {
      expect(Object.keys(t).sort()).toEqual(
        ['alt', 'left', 'panel', 'spill', 'src', 'top', 'width'],
      )
      expect(Number.isFinite(t.left)).toBe(true)
      expect(Number.isFinite(t.top)).toBe(true)
      expect(t.width).toBeGreaterThan(0)
    })
  })

  // Fitted to their panels, not stretched over them: a shipped picture that needed
  // three times its panel's width to be seen whole would mean the fit was recomputed
  // from the wrong box.
  it('ships every picture at a width its panel can hold', () => {
    PANEL_IMG_TRANSFORMS.forEach(t => {
      expect(t.width).toBeGreaterThanOrEqual(50)
      expect(t.width).toBeLessThanOrEqual(100)
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
