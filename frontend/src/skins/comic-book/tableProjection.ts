import type { NormPt } from './panelGeometry'

// Putting flat HTML content onto a surface drawn in a photograph — a notepad shot at an
// angle, a whiteboard, a telephone keypad. Everything here is pure geometry; the
// renderers are ProjectedTable.tsx and ProjectedNumberPad.tsx, and the editor's shared
// grips are in editor/TableCorners.tsx.
//
// The tilt is expressed as **four corners**, not as rotateX/rotateY/perspective. Three
// angle sliders can describe a plane but cannot describe *which* plane the photographer
// was standing in front of, so aligning them to ruled lines drawn in a picture is a
// three-way search where every axis undoes the last. Four corners is a direct
// manipulation: drag each one onto the corner of the ruled area and the fit is exact,
// including the perspective convergence, because a projective map through four point
// correspondences is unique.

/** The four corners of a projected surface, clockwise from top-left, in % of the frame. */
export type Quad = [NormPt, NormPt, NormPt, NormPt]

/** A brand-new surface: inset from the frame so all four grips are on screen to grab. */
export const DEFAULT_QUAD: Quad = [
  [10, 10],
  [90, 10],
  [90, 90],
  [10, 90],
]

/** How far a corner may be dragged outside its frame, in % — enough to hang off an edge. */
export const QUAD_RANGE = { min: -100, max: 200 }

/** The quad's corners in px inside the frame box. */
export function quadPx(quad: Quad, w: number, h: number): [number, number][] {
  return quad.map(([x, y]) => [(x / 100) * w, (y / 100) * h] as [number, number])
}

/** The quad's corners in viewport coordinates — where the editor draws its grips. */
export function quadViewport(
  rect: { x: number; y: number; w: number; h: number },
  quad: Quad,
): [number, number][] {
  return quadPx(quad, rect.w, rect.h).map(([x, y]) => [rect.x + x, rect.y + y] as [number, number])
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

/**
 * The size to lay the surface out at *before* it is projected, in px: the mean of the
 * quad's two horizontal edges by the mean of its two vertical ones.
 *
 * Laying out in the frame's own size and letting the transform shrink it would be
 * simpler and is wrong for text: a 3D-transformed element is rasterised once at its
 * layout size, so content laid out four times larger than the quad it lands in is
 * downsampled lettering. Matching the average edge keeps the scale near 1 in the middle
 * of the surface, which is where a reader is looking.
 *
 * A degenerate quad (a line, a point) has no interior to lay out in; the caller gets a
 * zero box and draws nothing rather than dividing by it.
 */
export function quadSourceBox(quad: Quad, w: number, h: number): { w: number; h: number } {
  const [p0, p1, p2, p3] = quadPx(quad, w, h)
  return {
    w: (dist(p0, p1) + dist(p3, p2)) / 2,
    h: (dist(p0, p3) + dist(p1, p2)) / 2,
  }
}

/**
 * The projective transform taking the **unit square** — (0,0), (1,0), (1,1), (0,1) — onto
 * `pts`, as the eight free coefficients of
 *
 * ```text
 *     [ a b c ]
 * H = [ d e f ]
 *     [ g h 1 ]
 * ```
 *
 * Null when the quad is degenerate: three collinear corners leave the system singular,
 * and a matrix built from the division that follows would be `NaN` all through, which
 * CSS drops silently — the table would simply vanish with no clue why.
 */
export function unitHomography(pts: [number, number][]): number[] | null {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = pts
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  const den = dx1 * dy2 - dx2 * dy1
  if (!Number.isFinite(den) || Math.abs(den) < 1e-9) return null

  const g = (sx * dy2 - dx2 * sy) / den
  const h = (dx1 * sy - sx * dy1) / den
  const coefficients = [
    x1 - x0 + g * x1, // a
    x3 - x0 + h * x3, // b
    x0, // c
    y1 - y0 + g * y1, // d
    y3 - y0 + h * y3, // e
    y0, // f
    g,
    h,
  ]
  return coefficients.every(Number.isFinite) ? coefficients : null
}

/** Push a point through a homography from {@link unitHomography}. Used by the tests. */
export function applyHomography(m: number[], x: number, y: number): [number, number] {
  const [a, b, c, d, e, f, g, h] = m
  const w = g * x + h * y + 1
  return [(a * x + b * y + c) / w, (d * x + e * y + f) / w]
}

/**
 * The CSS `transform` that lands a `src.w` by `src.h` box, drawn at the frame's origin
 * with `transform-origin: 0 0`, exactly on the quad.
 *
 * `matrix3d` is column-major, and the third row and column are the identity: the surface
 * is a plane, so nothing has a z. The perspective divide lives in the fourth *row*
 * (`g`, `h`), which is what makes the far edge of the table converge the way the ruled
 * lines in the photograph do — a `rotateX` under a `perspective()` would too, but only
 * for the one viewing distance that happened to be typed in.
 *
 * Returns `'none'` for a degenerate quad or an empty source box.
 */
export function quadMatrix3d(
  quad: Quad,
  frame: { w: number; h: number },
  src: { w: number; h: number },
): string {
  if (src.w <= 0 || src.h <= 0) return 'none'
  const m = unitHomography(quadPx(quad, frame.w, frame.h))
  if (!m) return 'none'
  // Pre-scale by 1/src so the map starts from the laid-out box rather than the unit
  // square: every column that multiplies x is divided by the width, every y column by
  // the height.
  const [a, b, c, d, e, f, g, h] = m
  const v = [a / src.w, d / src.w, 0, g / src.w, b / src.h, e / src.h, 0, h / src.h, 0, 0, 1, 0, c, f, 0, 1]
  return `matrix3d(${v.map(n => round(n)).join(', ')})`
}

/**
 * Trim floating-point noise off a coefficient, by *significant digits* rather than by
 * decimal places.
 *
 * The sixteen coefficients span orders of magnitude — a translation is hundreds of
 * pixels, the two perspective terms are around a ten-thousandth — and rounding them all
 * to the same decimal place is therefore not the same accuracy twice. Six decimals cost
 * the perspective terms four of their six digits, and because those terms are divided
 * *into* every coordinate, the surface then missed its own corners by a twentieth of a
 * pixel. Twelve significant digits is noise-free at both ends.
 */
function round(n: number): number {
  return n === 0 || !Number.isFinite(n) ? n : Number(n.toPrecision(12))
}

/** The surface geometry a renderer needs, in one call. */
export function surfaceStyle(
  surface: { quad: Quad },
  frame: { w: number; h: number },
): { width: number; height: number; transform: string } {
  const src = quadSourceBox(surface.quad, frame.w, frame.h)
  return {
    width: src.w,
    height: src.h,
    transform: quadMatrix3d(surface.quad, frame, src),
  }
}
