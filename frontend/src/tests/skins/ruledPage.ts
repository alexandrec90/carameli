import type { PixelGrid } from '../../skins/comic-book/editor/ruledLines'

// A ruled page drawn by the test, so the fit is checked against lines whose positions are
// known to the pixel rather than against a decoded WebP — a test that decoded one would be
// testing an image decoder, and could not draw a ruling that is *deliberately* uneven.

export interface RuledPageSpec {
  width: number
  height: number
  /**
   * Centre of each rule at x = 0, in continuous coordinates. Drawn two rows thick with
   * the centre on the value, so row `y - 1` and row `y` are painted for an integer `y`.
   */
  lineYs: number[]
  /** Rise of every rule per px of x; 0 is level. */
  slope?: number
  /** Centre x of the red margin line, or null for a page with none. */
  margin?: number | null
  /** Where the rules start and stop, in px. */
  lineLeft: number
  lineRight: number
  /** Lines whose right end is covered from this x on — a hand over the page. */
  coveredFrom?: { fromLine: number; x: number }
}

const PAGE: [number, number, number] = [250, 240, 200]
const RULE: [number, number, number] = [60, 170, 220]
const MARGIN: [number, number, number] = [220, 30, 40]

/** Paint a page to the spec. */
export function ruledPage(spec: RuledPageSpec): PixelGrid {
  const { width, height, lineYs, lineLeft, lineRight } = spec
  const slope = spec.slope ?? 0
  const data = new Uint8ClampedArray(width * height * 4)
  const put = (x: number, y: number, [r, g, b]: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 4
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, PAGE)

  lineYs.forEach((y0, k) => {
    const right = spec.coveredFrom && k >= spec.coveredFrom.fromLine
      ? Math.min(lineRight, spec.coveredFrom.x)
      : lineRight
    for (let x = lineLeft; x < right; x++) {
      const centre = y0 + slope * x
      const top = Math.round(centre) - 1
      put(x, top, RULE)
      put(x, top + 1, RULE)
    }
  })

  if (spec.margin !== null && spec.margin !== undefined) {
    const x = Math.round(spec.margin)
    for (let y = Math.floor(height * 0.08); y < Math.floor(height * 0.95); y++) {
      put(x - 1, y, MARGIN)
      put(x, y, MARGIN)
    }
  }
  return { width, height, data }
}

/** The line's centre y at `x`, as drawn. */
export function drawnY(spec: RuledPageSpec, k: number, x: number): number {
  return spec.lineYs[k]! + (spec.slope ?? 0) * x
}
