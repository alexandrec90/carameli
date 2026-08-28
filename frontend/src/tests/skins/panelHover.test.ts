import { describe, expect, it } from 'vitest'

import { hoveredPanelAt, pointInPolygon } from '../../skins/comic-book/panelHover'
import type { ImgTransform } from '../../skins/comic-book/editor/types'
import type { PanelPoly } from '../../skins/comic-book/panelGeometry'

// Two panels either side of a slanted seam. Panel 0's bounding rectangle reaches
// x=100, well across the seam into panel 1's polygon — the exact overlap where the
// old element-based hover answered for the wrong panel.
//
//   0,0 ────────────── 100,0   105,0 ────── 200,0
//    │  panel 0      ⟍            ⟍  panel 1  │
//   0,100 ── 60,100     ⟍     65,100 ─── 200,100
const POLYS: (PanelPoly | null)[] = [
  {
    vp: [[0, 0], [100, 0], [60, 100], [0, 100]],
    bounds: { x: 0, y: 0, w: 100, h: 100 },
  },
  {
    vp: [[105, 0], [200, 0], [200, 100], [65, 100]],
    bounds: { x: 65, y: 0, w: 135, h: 100 },
  },
]

const img = (over: Partial<ImgTransform>): ImgTransform => ({
  panel: 0, src: 'a.webp', alt: '', left: 0, top: 0, width: 100, height: 100,
  scale: 1, offsetX: 0, offsetY: 0, anchor: 'center center', spill: false, ...over,
})

const at = (
  x: number,
  y: number,
  over: {
    images?: ImgTransform[]
    natSizes?: Record<string, { w: number; h: number }>
    current?: number | null
    overInk?: (x: number, y: number, panel: number) => boolean
  } = {},
): number | null =>
  hoveredPanelAt(
    x, y, POLYS, over.images ?? [], over.natSizes ?? {}, over.current ?? null, over.overInk,
  )

describe('pointInPolygon', () => {
  it('answers for the polygon, not its bounding box', () => {
    const poly = POLYS[0]!.vp
    expect(pointInPolygon(30, 50, poly)).toBe(true)
    // Inside the bounding rectangle, outside the slanted edge.
    expect(pointInPolygon(95, 90, poly)).toBe(false)
    expect(pointInPolygon(-5, 50, poly)).toBe(false)
  })
})

describe('hoveredPanelAt', () => {
  it('lights the panel whose polygon holds the point, not whose rectangle does', () => {
    // (95, 90) is inside panel 0's bounding rect but inside panel 1's polygon.
    expect(at(95, 90)).toBe(1)
    expect(at(30, 50)).toBe(0)
  })

  it('lights nothing over the gutter between two polygons', () => {
    // At y=50 panel 0 ends at x=80 and panel 1 begins at x=85.
    expect(at(82, 50)).toBeNull()
  })

  it('skips null slots (panels on the other page)', () => {
    expect(hoveredPanelAt(30, 50, [null, POLYS[1]], [], {}, null)).toBeNull()
  })

  describe('the overInk probe (the renderer answering for drawn balloons)', () => {
    // Balloons have no rectangle test here at all: the only thing that keeps a hover
    // past the seam is the outline the renderer actually drew, which usePanelHover
    // measures. Modelled as ink covering x 80..120, y 10..40 of panel 0.
    const overInk = (x: number, y: number, panel: number): boolean =>
      panel === 0 && x >= 80 && x <= 120 && y >= 10 && y <= 40

    it('keeps the hover on ink the probe vouches for', () => {
      expect(at(110, 20, { current: 0, overInk })).toBe(0)
    })

    it('asks only about the hovered panel — hidden ink cannot grab the pointer', () => {
      expect(at(110, 20, { current: 1, overInk })).toBe(1)
      expect(at(110, 20, { current: null, overInk })).toBe(1)
    })

    it('releases the hover the moment the probe finds nothing under the point', () => {
      // One pixel past the ink, still where a balloon's box would be.
      expect(at(121, 20, { current: 0, overInk })).toBe(1)
      expect(at(110, 41, { current: 0, overInk })).toBe(1)
      expect(at(150, 80, { current: 0, overInk })).toBe(1)
    })

    it('falls back to the polygons without a probe', () => {
      expect(at(110, 20, { current: 0 })).toBe(1)
    })
  })

  describe('the stylesheets defer to the geometric hover', () => {
    // The panel element is the polygon's bounding rectangle, so the browser's own
    // `:hover` on it answers for the wrong shape — the historical bug: a chain spilled
    // over a seam kept the geometric hover (balloons visible) while `:hover` colorized
    // the neighbour underneath. Anything hover-driven on a panel keys off the
    // `cb-panel-hot` class instead. Same glob rationale as comicBookImageBorders.
    const CSS = import.meta.glob('../../skins/comic-book/**/*.css', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>

    it('finds the skin stylesheets', () => {
      expect(Object.keys(CSS).length).toBeGreaterThan(5)
    })

    it('never styles anything off the panel element’s own :hover', () => {
      const offenders = Object.entries(CSS).flatMap(([file, css]) =>
        css.includes('.cb-panel:hover') ? [file] : [])
      expect(offenders).toEqual([])
    })

    it('colorizes the dots and the pictures from cb-panel-hot', () => {
      const css = Object.values(CSS).join('\n')
      expect(css).toContain('.cb-panel-hot .cb-dots-panel-canvas')
      expect(css).toContain('.cb-panel-hot .cb-panel-img')
    })
  })

  describe('a spilled picture', () => {
    // Frame x 70..130, y 0..50: hangs over the seam into panel 1.
    const images = [img({ left: 70, top: 0, width: 60, height: 50, spill: true })]

    it('claims the hover for its owner whichever panel is under the point', () => {
      expect(at(110, 25, { images })).toBe(0)
      expect(at(110, 25, { images, current: 1 })).toBe(0)
    })

    it('claims only the artwork once its natural size is known', () => {
      // A square source contain-fits the 60×50 frame at 50×50, centred: x 75..125.
      const natSizes = { 'a.webp': { w: 100, h: 100 } }
      expect(at(110, 25, { images, natSizes })).toBe(0)
      expect(at(128, 25, { images, natSizes })).toBe(1)
    })

    it('claims nothing without spill — the panel clip hides the overhang', () => {
      const clipped = [img({ left: 70, top: 0, width: 60, height: 50 })]
      expect(at(110, 25, { images: clipped })).toBe(1)
    })
  })
})
