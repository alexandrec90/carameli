import { describe, expect, it } from 'vitest'

import {
  clampVertex,
  constraintOf,
  EDGE_MARGIN,
  frameRect,
  gridPolys,
  HALF_GUTTER,
  insetPolygon,
  layoutKindFor,
  OUTER_M,
  PAGE_ASPECT,
  polyBounds,
  toNormalized,
  toViewport,
} from '../../skins/comic-book/panelGeometry'
import type { NormPt, PanelGrid, VpPt } from '../../skins/comic-book/panelGeometry'

// The geometry the panel-shape editor rests on. The property worth the most here is the
// gutter one: an author may drag a seam to any angle, and the gap either side of it has
// to stay the same width whatever angle that is.

const W = 1000
const H = 800
const F = frameRect(W, H)

/**
 * Two panels split by one seam, given as the seam's two ends. The left panel is
 * `[topLeft, seamTop, seamBottom, bottomLeft]`, the right one the mirror of it, so both
 * name the *same two* vertices for the seam — which is what makes it one line.
 */
function splitGrid(seamTop: NormPt, seamBottom: NormPt): PanelGrid {
  return {
    vertices: [[0, 0], seamTop, seamBottom, [0, 1], [1, 0], [1, 1]],
    panels: [
      [0, 1, 2, 3],
      [1, 4, 5, 2],
    ],
  }
}

/** Perpendicular distance from `p` to the infinite line through `a` and `b`. */
function distToLine(p: VpPt, a: VpPt, b: VpPt): number {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const len = Math.hypot(ux, uy)
  return Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux) / len
}

/** Twice the area of a polygon, unsigned — for "did the inset shrink it or grow it". */
function area(pts: VpPt[]): number {
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[(i + 1) % pts.length]
    sum += ax * by - bx * ay
  }
  return Math.abs(sum) / 2
}

describe('layoutKindFor', () => {
  it('reads the three window shapes off the aspect ratio', () => {
    expect(layoutKindFor(600, 900)).toBe('portrait')
    expect(layoutKindFor(1600, 900)).toBe('landscape')
    expect(layoutKindFor(1000, 1000)).toBe('square')
  })

  it('treats a near-square window as square rather than flipping on a pixel', () => {
    expect(layoutKindFor(900, 1000)).toBe('square')
    expect(layoutKindFor(1100, 1000)).toBe('square')
  })
})

describe('frameRect and the normalised space', () => {
  // The frame has one aspect per window shape and is letterboxed into the viewport.
  // That is the whole fix for pictures wandering on resize: every panel is a fraction
  // of the frame, so a frame that followed the window reshaped every panel with it.
  it('holds the window shape\'s fixed aspect, whatever the window\'s own', () => {
    for (const [w, h] of [[1600, 900], [2560, 1080], [1300, 1000], [1000, 800]]) {
      const f = frameRect(w, h)
      expect(f.w / f.h).toBeCloseTo(PAGE_ASPECT[layoutKindFor(w, h)], 10)
    }
    for (const [w, h] of [[600, 900], [400, 1000], [500, 600]]) {
      const f = frameRect(w, h)
      expect(f.w / f.h).toBeCloseTo(PAGE_ASPECT.portrait, 10)
    }
  })

  it('is the largest such rectangle inside the margins, centred', () => {
    // 1600×900 is landscape: the margin box is 1584×884, and 884 × 1.6 = 1414.4 is the
    // width the height allows, so the height is the tight axis and the bars fall left
    // and right.
    const wide = frameRect(1600, 900)
    expect(wide.h).toBe(884)
    expect(wide.w).toBeCloseTo(1414.4, 10)
    expect(wide.x).toBeCloseTo(OUTER_M + (1584 - 1414.4) / 2, 10)
    expect(wide.y).toBe(OUTER_M)
    // 1300×1000 is landscape too, but the width is now the tight axis: 1284 wide,
    // 802.5 high, bars above and below.
    const squat = frameRect(1300, 1000)
    expect(squat.w).toBe(1284)
    expect(squat.h).toBeCloseTo(802.5, 10)
    expect(squat.x).toBe(OUTER_M)
    expect(squat.y).toBeCloseTo(OUTER_M + (984 - 802.5) / 2, 10)
    // A square window gets the square page edge to edge.
    expect(frameRect(1000, 1000)).toEqual({ x: OUTER_M, y: OUTER_M, w: 984, h: 984 })
  })

  it('never leaves the margin box', () => {
    for (const [w, h] of [[1600, 900], [600, 900], [1000, 1000], [3000, 500], [300, 3000]]) {
      const f = frameRect(w, h)
      expect(f.x).toBeGreaterThanOrEqual(OUTER_M)
      expect(f.y).toBeGreaterThanOrEqual(OUTER_M)
      expect(f.x + f.w).toBeLessThanOrEqual(w - OUTER_M + 1e-9)
      expect(f.y + f.h).toBeLessThanOrEqual(h - OUTER_M + 1e-9)
    }
  })

  it('gives two windows of one shape geometrically similar frames', () => {
    // The property the pictures rest on: a panel at (0.2, 0.3)-(0.7, 0.9) of the frame
    // has the same aspect ratio in both windows, so a picture contain-fitted into it is
    // sized by the same axis in both.
    const a = frameRect(1600, 900)
    const b = frameRect(2600, 1100)
    const panelAspect = (f: { w: number; h: number }) => (0.5 * f.w) / (0.6 * f.h)
    expect(panelAspect(a)).toBeCloseTo(panelAspect(b), 10)
  })

  it('never returns a negative frame for a viewport smaller than its own margins', () => {
    expect(frameRect(4, 4)).toEqual({ x: OUTER_M, y: OUTER_M, w: 0, h: 0 })
    expect(frameRect(4, 400)).toEqual({ x: OUTER_M, y: 200, w: 0, h: 0 })
  })

  // The editor holds a page at a shape the window is not. The frame is then that
  // shape's, letterboxed into the window it happens to be in — which is what makes a
  // portrait grid tuned on a landscape monitor the same page a phone shows.
  it('draws a held shape at its own aspect, letterboxed into a window of another', () => {
    const held = frameRect(1600, 900, 'portrait')
    expect(held.w / held.h).toBeCloseTo(PAGE_ASPECT.portrait, 10)
    expect(held.h).toBe(884)
    expect(held.w).toBeCloseTo(884 * PAGE_ASPECT.portrait, 10)
    expect(held.x).toBeCloseTo(OUTER_M + (1584 - held.w) / 2, 10)
    // And a held shape that is the window's own is exactly the frame it would get anyway.
    expect(frameRect(1600, 900, 'landscape')).toEqual(frameRect(1600, 900))
  })

  it('gives two windows of one shape geometrically similar panels', () => {
    // The property the frame test above proves is carried through gridPolys: the rings
    // are exactly similar, and the drawn panels similar to within the gutter, which is
    // a fixed px inset and so a slightly larger share of a smaller frame.
    const grid = splitGrid([0.6, 0], [0.35, 1])
    const small = gridPolys(grid, frameRect(1200, 800))
    const large = gridPolys(grid, frameRect(2600, 1300))
    for (const i of [0, 1]) {
      const a = small[i].bounds
      const b = large[i].bounds
      expect(a.w / a.h).toBeCloseTo(b.w / b.h, 1)
      expect(a.w / a.h).not.toBeCloseTo(b.w / b.h, 6)
    }
  })

  it('round-trips a point through viewport pixels and back', () => {
    const p: NormPt = [0.37, 0.62]
    const back = toNormalized(toViewport(p, F), F)
    expect(back[0]).toBeCloseTo(p[0], 10)
    expect(back[1]).toBeCloseTo(p[1], 10)
  })
})

describe('constraintOf', () => {
  it('locks the four frame corners', () => {
    for (const corner of [[0, 0], [1, 0], [0, 1], [1, 1]] as NormPt[]) {
      expect(constraintOf(corner)).toBe('locked')
    }
  })

  it('names the edge a frame vertex slides along', () => {
    expect(constraintOf([0.4, 0])).toBe('top')
    expect(constraintOf([0.4, 1])).toBe('bottom')
    expect(constraintOf([0, 0.4])).toBe('left')
    expect(constraintOf([1, 0.4])).toBe('right')
  })

  it('calls an interior vertex free', () => {
    expect(constraintOf([0.5, 0.5])).toBe('free')
  })
})

describe('clampVertex', () => {
  it('holds a frame vertex on its own edge however far it is dragged', () => {
    expect(clampVertex([0.4, 0.9], 'top')).toEqual([0.4, 0])
    expect(clampVertex([-2, 0.4], 'left')).toEqual([0, 0.4])
    // Not quite to the bottom, though: a right-edge vertex dragged into the corner would
    // come back from constraintOf as `locked`, and stop being draggable at all.
    expect(clampVertex([0.5, 3], 'right')).toEqual([1, 1 - EDGE_MARGIN])
  })

  it('refuses to move a locked corner at all', () => {
    expect(clampVertex([0.3, 0.7], 'locked')).toEqual([0.3, 0.7])
  })

  /*
   * The reason the margin exists: a free vertex dragged onto the frame would come back
   * from constraintOf as an *edge* vertex, and its class would have changed underneath
   * the drag that was still holding it. Stopping short keeps a vertex the kind of vertex
   * it was created as.
   */
  it('keeps a free vertex clear of the frame, so its constraint cannot change', () => {
    const clamped = clampVertex([-0.5, 1.5], 'free')
    expect(clamped[0]).toBeCloseTo(EDGE_MARGIN, 10)
    expect(clamped[1]).toBeCloseTo(1 - EDGE_MARGIN, 10)
    expect(constraintOf(clamped)).toBe('free')
  })
})

describe('insetPolygon', () => {
  it('shrinks a square by the inset on every side', () => {
    const square: VpPt[] = [[0, 0], [100, 0], [100, 100], [0, 100]]
    expect(insetPolygon(square, 10)).toEqual([[10, 10], [90, 10], [90, 90], [10, 90]])
  })

  /*
   * A ring may be authored either way round — a panel's vertices are listed in whatever
   * order reads best next to its neighbours. Reading the winding rather than assuming it
   * is what stops an anticlockwise ring insetting *outward* and swallowing the panel next
   * to it.
   */
  it('shrinks an anticlockwise ring too, rather than ballooning it', () => {
    const square: VpPt[] = [[0, 0], [100, 0], [100, 100], [0, 100]]
    const reversed = [...square].reverse()
    expect(area(insetPolygon(reversed, 10))).toBeLessThan(area(reversed))
    expect(area(insetPolygon(reversed, 10))).toBeCloseTo(area(insetPolygon(square, 10)), 6)
  })

  it('leaves a collinear bend alone instead of producing NaN', () => {
    // The middle point of the top edge is a bend that has not been dragged off straight:
    // its two offset lines are parallel, so there is no intersection to compute.
    const withBend: VpPt[] = [[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]]
    const out = insetPolygon(withBend, 10)
    expect(out.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
    expect(out[1]).toEqual([50, 10])
  })

  it('returns the ring untouched for a degenerate polygon or a zero inset', () => {
    const line: VpPt[] = [[0, 0], [10, 0]]
    expect(insetPolygon(line, 7)).toEqual(line)
    expect(insetPolygon([[0, 0], [10, 0], [10, 10]], 0)).toEqual([[0, 0], [10, 0], [10, 10]])
  })
})

describe('polyBounds', () => {
  it('boxes a polygon whatever order its points come in', () => {
    expect(polyBounds([[30, 10], [5, 40], [20, 4]])).toEqual({ x: 5, y: 4, w: 25, h: 36 })
  })

  it('is a zero box for an empty ring rather than an Infinity one', () => {
    expect(polyBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('gridPolys gutters', () => {
  /**
   * Measure the gap either side of the seam of a two-panel `splitGrid`: the left panel's
   * seam edge is its points 1→2, the right panel's is its points 3→0 (the same two
   * vertices, walked the other way round).
   */
  function gutterAcrossSeam(grid: PanelGrid): number[] {
    const [left, right] = gridPolys(grid, F)
    return [
      distToLine(left.vp[1], right.vp[3], right.vp[0]),
      distToLine(left.vp[2], right.vp[3], right.vp[0]),
    ]
  }

  it('leaves a full gutter between two panels split straight down the middle', () => {
    for (const d of gutterAcrossSeam(splitGrid([0.5, 0], [0.5, 1]))) {
      expect(d).toBeCloseTo(2 * HALF_GUTTER, 6)
    }
  })

  /*
   * The regression this whole geometry exists for. The layout it replaced inset each
   * panel by `± HALF_GUTTER` on x and y independently, which is the right distance only
   * when the seam is axis-aligned: at any other angle the two panels close to
   * `HALF_GUTTER × cos θ` of each other, so a diagonal read as a thinner line the further
   * it leaned. Offsetting perpendicular to the edge makes the gap the same at every angle.
   */
  it('leaves the same gutter across a steeply diagonal seam', () => {
    for (const d of gutterAcrossSeam(splitGrid([0.7, 0], [0.25, 1]))) {
      expect(d).toBeCloseTo(2 * HALF_GUTTER, 6)
    }
  })

  it('leaves the same gutter across a nearly horizontal seam', () => {
    for (const d of gutterAcrossSeam(splitGrid([0, 0.48], [1, 0.52]))) {
      expect(d).toBeCloseTo(2 * HALF_GUTTER, 6)
    }
  })

  it('keeps every panel inside the page frame', () => {
    const polys = gridPolys(splitGrid([0.6, 0], [0.35, 1]), F)
    for (const poly of polys) {
      expect(poly.bounds.x).toBeGreaterThanOrEqual(F.x)
      expect(poly.bounds.y).toBeGreaterThanOrEqual(F.y)
      expect(poly.bounds.x + poly.bounds.w).toBeLessThanOrEqual(F.x + F.w)
      expect(poly.bounds.y + poly.bounds.h).toBeLessThanOrEqual(F.y + F.h)
    }
  })

  it('gives a bent seam a bent panel, not a straightened one', () => {
    // A lightning bolt: the seam runs top → middle-left → bottom.
    const bolt: PanelGrid = {
      vertices: [[0, 0], [0.5, 0], [0.3, 0.5], [0.5, 1], [0, 1], [1, 0], [1, 1]],
      panels: [
        [0, 1, 2, 3, 4],
        [1, 5, 6, 3, 2],
      ],
    }
    const [left, right] = gridPolys(bolt, F)
    expect(left.vp).toHaveLength(5)
    expect(right.vp).toHaveLength(5)
    // The kink survives the inset: the middle point is still left of both its neighbours.
    expect(left.vp[2][0]).toBeLessThan(left.vp[1][0])
    expect(left.vp[2][0]).toBeLessThan(left.vp[3][0])
    // And the upper limb of the bolt keeps its full gutter, bend included: the right
    // panel's matching edge runs between its points 0 and 4 (vertices 1 and 2).
    expect(distToLine(left.vp[1], right.vp[0], right.vp[4])).toBeCloseTo(2 * HALF_GUTTER, 6)
    expect(distToLine(left.vp[2], right.vp[0], right.vp[4])).toBeCloseTo(2 * HALF_GUTTER, 6)
  })
})
