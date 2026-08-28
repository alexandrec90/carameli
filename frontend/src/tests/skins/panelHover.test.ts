import { describe, expect, it } from 'vitest'

import { BUBBLE_ASPECT } from '../../skins/comic-book/bubbleBox'
import { hoveredPanelAt, pointInPolygon } from '../../skins/comic-book/panelHover'
import type { BubbleTransform, ImgTransform } from '../../skins/comic-book/editor/types'
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

const bub = (over: Partial<BubbleTransform>): BubbleTransform => ({
  panel: 0, top: 0, right: 0, width: 40, rotate: 0, spill: true, type: 'soft',
  tail: 'none', content: 'text', text: '', linkTo: null, hoverType: null,
  clickType: null, chain: '', ...over,
})

const at = (
  x: number,
  y: number,
  over: {
    images?: ImgTransform[]
    bubbles?: BubbleTransform[]
    natSizes?: Record<string, { w: number; h: number }>
    current?: number | null
  } = {},
): number | null =>
  hoveredPanelAt(
    x, y, POLYS,
    over.images ?? [], over.bubbles ?? [], over.natSizes ?? {}, over.current ?? null,
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
    expect(hoveredPanelAt(30, 50, [null, POLYS[1]], [], [], {}, null)).toBeNull()
  })

  describe('a spilled bubble of the hovered panel', () => {
    // right: -20 hangs the balloon past panel 0's right edge: its box runs
    // x 80..120, y 10..10+40·aspect — over the seam and into panel 1's polygon.
    const bubbles = [bub({ top: 10, right: -20, width: 40 })]
    const inBubble: [number, number] = [110, 10 + (40 * BUBBLE_ASPECT) / 2]

    it('keeps the hover while the pointer rides it over the seam', () => {
      expect(at(...inBubble, { bubbles, current: 0 })).toBe(0)
    })

    it('does not grab the hover while its panel is not the hovered one', () => {
      // Not hovered means not revealed: invisible ink must not take the pointer.
      expect(at(...inBubble, { bubbles, current: null })).toBe(1)
      expect(at(...inBubble, { bubbles, current: 1 })).toBe(1)
    })

    it('does not stick without spill — the clip hides it past the seam', () => {
      const clipped = [bub({ top: 10, right: -20, width: 40, spill: false })]
      expect(at(...inBubble, { bubbles: clipped, current: 0 })).toBe(1)
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
