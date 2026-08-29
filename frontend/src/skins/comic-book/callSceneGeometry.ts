import { HALF_GUTTER } from './panelGeometry'
import type { Rect, VpPt } from './panelGeometry'

/**
 * Splitting a panel polygon in two for the call scene (PanelCallScene.tsx).
 *
 * The cut is a vertical line through the middle of the panel's box, and each side is
 * inset from it by `HALF_GUTTER` — the same inset every grid seam gets, so the gutter
 * between the halves is the width of every other gutter on the page. A vertical cut is
 * perpendicular to itself, which is why the per-axis inset here is not the diagonal
 * mistake `polygonInset.ts` exists to avoid. Pure: the polygon comes from the grid, and
 * the halves follow it however the grid is dragged.
 */
export interface SceneHalf {
  /** Viewport polygon, like the panel's own `vp`. */
  pts: VpPt[]
  /** Its bounding box, in viewport px — where the half's element sits. */
  box: Rect
}

export interface SceneHalves {
  left: SceneHalf
  right: SceneHalf
  /** The cut line, in viewport px; the gutter is `HALF_GUTTER` either side of it. */
  cutX: number
}

/**
 * The part of `poly` on `side` of the line `x = edge` — Sutherland–Hodgman against one
 * vertical line. A vertex on the line counts as inside for both sides, so the two halves
 * of a cut share their seam exactly.
 */
export function clipAtX(poly: readonly VpPt[], edge: number, side: 'left' | 'right'): VpPt[] {
  const inside = ([x]: VpPt): boolean => (side === 'left' ? x <= edge : x >= edge)
  const out: VpPt[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const aIn = inside(a)
    if (aIn) out.push(a)
    if (aIn !== inside(b)) {
      // The edge crosses the line, so the two x's differ and the division is safe.
      const t = (edge - a[0]) / (b[0] - a[0])
      out.push([edge, a[1] + t * (b[1] - a[1])])
    }
  }
  return out
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

/** Cut the panel down the middle of its box, a gutter's width apart. */
export function splitAcross(vp: readonly VpPt[], bounds: Rect): SceneHalves {
  const cutX = bounds.x + bounds.w / 2
  const left = clipAtX(vp, cutX - HALF_GUTTER, 'left')
  const right = clipAtX(vp, cutX + HALF_GUTTER, 'right')
  return {
    left: { pts: left, box: boundsOf(left) },
    right: { pts: right, box: boundsOf(right) },
    cutX,
  }
}
