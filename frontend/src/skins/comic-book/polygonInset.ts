import type { Rect, VpPt } from './panelGeometry'

// The import above is type-only and so erased at compile time: this module is a leaf
// at runtime even though panelGeometry.ts imports it back.
//
// Polygon maths, kept apart from the grid it serves: nothing here knows what a panel is.
// The one that matters is `insetPolygon` — the gutter has to be the same width on a
// slanted seam as on a straight one, and the per-axis inset it replaced narrowed by the
// cosine of the angle, so a diagonal read as a thinner line the further it leaned.

/** Beyond this multiple of the inset, a miter is cut back to the plain offset point. */
const MITER_LIMIT = 6

/** Twice the signed area; its sign is the winding, which inset needs and shape does not. */
function shoelace(pts: VpPt[]): number {
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[(i + 1) % pts.length]
    sum += ax * by - bx * ay
  }
  return sum
}

/** Axis-aligned box of a polygon. */
export function polyBounds(pts: VpPt[]): Rect {
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  const xs = pts.map(p => p[0])
  const ys = pts.map(p => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/**
 * Shrink a polygon by `d` on every edge, measured perpendicular to that edge.
 *
 * Each edge is offset inward along its own normal and consecutive offsets are
 * intersected, so the result keeps the original's angles: a slanted seam stays slanted
 * and a bend stays a bend. Two edges that were collinear have parallel offsets and no
 * intersection — there the offset point itself is the answer, which is why a bend that
 * has not been dragged off the straight is a no-op rather than a NaN.
 *
 * The winding is read from the polygon rather than assumed, so a ring authored
 * anticlockwise insets inward like any other instead of ballooning outward.
 */
export function insetPolygon(pts: VpPt[], d: number): VpPt[] {
  const n = pts.length
  if (n < 3 || d === 0) return pts.map(p => [p[0], p[1]] as VpPt)
  const sign = shoelace(pts) > 0 ? 1 : -1

  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n]
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const len = Math.hypot(ux, uy) || 1
    const dx = ux / len
    const dy = uy / len
    // Inward normal for this winding.
    const nx = -dy * sign
    const ny = dx * sign
    return { px: a[0] + nx * d, py: a[1] + ny * d, dx, dy }
  })

  return pts.map((p, i) => {
    const prev = lines[(i - 1 + n) % n]
    const cur = lines[i]
    // Cross product of the two directions, prev × cur. Written the other way round it
    // is the same magnitude with the opposite sign, which lands `t` the same distance
    // along the previous edge in the wrong direction — a square then insets into a
    // pinwheel of four points, each offset by one edge only.
    const det = prev.dx * cur.dy - prev.dy * cur.dx
    if (Math.abs(det) < 1e-9) return [cur.px, cur.py] as VpPt
    const t = ((cur.px - prev.px) * cur.dy - (cur.py - prev.py) * cur.dx) / det
    const mx = prev.px + t * prev.dx
    const my = prev.py + t * prev.dy
    // A very acute corner throws its miter a long way out; cut it back rather than let
    // one spike swallow the neighbouring panel.
    if (Math.hypot(mx - p[0], my - p[1]) > MITER_LIMIT * Math.abs(d)) {
      return [cur.px, cur.py] as VpPt
    }
    return [mx, my] as VpPt
  })
}
