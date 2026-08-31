import { HALF_GUTTER } from './panelGeometry'
import type { Rect, VpPt } from './panelGeometry'

/**
 * Splitting a panel polygon in two for a call scene (PanelCallScene.tsx).
 *
 * The cut is a straight line across the panel's box — vertical or horizontal, wherever the
 * author put it — and each side is inset from it by `HALF_GUTTER`, the same inset every
 * grid seam gets, so the gutter between the halves is the width of every other gutter on
 * the page. An axis-aligned cut is perpendicular to itself, which is why the per-axis inset
 * here is not the diagonal mistake `polygonInset.ts` exists to avoid.
 *
 * Pure, and nothing here knows which panel it is cutting: the polygon comes from the grid
 * and the cut from the panel's own {@link CallSceneLayout}, so the halves follow the grid
 * however it is dragged and follow the author however the seam is moved.
 */
export interface SceneHalf {
  /** Viewport polygon, like the panel's own `vp`. */
  pts: VpPt[]
  /** Its bounding box, in viewport px — where the half's element sits. */
  box: Rect
}

/** Which way a scene's cut runs: `'x'` side by side, `'y'` one above the other. */
export type SceneAxis = 'x' | 'y'

export interface SceneHalves {
  /** The left half of an `'x'` cut, or the top half of a `'y'` one. */
  a: SceneHalf
  /** The right half of an `'x'` cut, or the bottom half of a `'y'` one. */
  b: SceneHalf
  /** The cut line, in viewport px along `axis`; the gutter is `HALF_GUTTER` either side. */
  at: number
  axis: SceneAxis
}

/**
 * Sutherland–Hodgman against one axis-aligned line. `keep` is whether a vertex on the
 * low side of `edge` survives — a vertex exactly *on* the line counts as inside either
 * way, so the two halves of a cut share their seam exactly.
 */
function clipAt(poly: readonly VpPt[], edge: number, axis: 0 | 1, low: boolean): VpPt[] {
  const inside = (p: VpPt): boolean => (low ? p[axis] <= edge : p[axis] >= edge)
  const other = axis === 0 ? 1 : 0
  const out: VpPt[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const aIn = inside(a)
    if (aIn) out.push(a)
    if (aIn !== inside(b)) {
      // The edge crosses the line, so the two coordinates differ and the division is safe.
      const t = (edge - a[axis]) / (b[axis] - a[axis])
      const crossed = a[other] + t * (b[other] - a[other])
      out.push(axis === 0 ? [edge, crossed] : [crossed, edge])
    }
  }
  return out
}

/** The part of `poly` on `side` of the vertical line `x = edge`. */
export function clipAtX(poly: readonly VpPt[], edge: number, side: 'left' | 'right'): VpPt[] {
  return clipAt(poly, edge, 0, side === 'left')
}

/** The part of `poly` on `side` of the horizontal line `y = edge`. */
export function clipAtY(poly: readonly VpPt[], edge: number, side: 'top' | 'bottom'): VpPt[] {
  return clipAt(poly, edge, 1, side === 'top')
}

/** The axis-aligned box around `pts`; a zero box for an empty polygon. */
export function boundsOf(pts: readonly VpPt[]): Rect {
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Where a half's element sits inside the panel element, which is itself placed at
 * `bounds`. Plain numbers rather than a style object: two components position a slot at a
 * half (PanelImages, PanelBubbles) and neither should be the one the other borrows it from.
 */
export function halfSlot(
  half: SceneHalf,
  bounds: Rect,
): { left: number; top: number; width: number; height: number } {
  return {
    left: half.box.x - bounds.x,
    top: half.box.y - bounds.y,
    width: half.box.w,
    height: half.box.h,
  }
}

/**
 * Cut the panel across its box at `cut` — a percentage along `axis`, so 50 is the middle
 * whatever shape the panel is — leaving a gutter's width between the halves.
 *
 * A percentage rather than pixels because that is what every other authored placement in
 * this skin is: a cut in pixels would sit somewhere different on each of the three window
 * shapes, and the author only ever looks at one of them.
 */
export function splitAt(
  vp: readonly VpPt[],
  bounds: Rect,
  cut: number,
  axis: SceneAxis,
): SceneHalves {
  const at = axis === 'x'
    ? bounds.x + (bounds.w * cut) / 100
    : bounds.y + (bounds.h * cut) / 100
  const first = axis === 'x'
    ? clipAtX(vp, at - HALF_GUTTER, 'left')
    : clipAtY(vp, at - HALF_GUTTER, 'top')
  const second = axis === 'x'
    ? clipAtX(vp, at + HALF_GUTTER, 'right')
    : clipAtY(vp, at + HALF_GUTTER, 'bottom')
  return {
    a: { pts: first, box: boundsOf(first) },
    b: { pts: second, box: boundsOf(second) },
    at,
    axis,
  }
}
