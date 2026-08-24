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
  it('insets the viewport by the outer margin on every side', () => {
    expect(F).toEqual({ x: OUTER_M, y: OUTER_M, w: W - 2 * OUTER_M, h: H - 2 * OUTER_M })
  })

  it('never returns a negative frame for a viewport smaller than its own margins', () => {
    expect(frameRect(4, 4)).toEqual({ x: OUTER_M, y: OUTER_M, w: 0, h: 0 })
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
    const [left, right] = gridPolys(grid, W, H)
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
    const polys = gridPolys(splitGrid([0.6, 0], [0.35, 1]), W, H)
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
    const [left, right] = gridPolys(bolt, W, H)
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
