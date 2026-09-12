import { ROW_COUNT } from '../tableData'
import { applyHomography, invertHomography, unitHomography } from '../tableProjection'
import type { Quad } from '../tableProjection'

// Finding the ruling drawn in a picture, and stating it as a projected table's geometry.
// Pure: it reads a block of RGBA pixels and returns numbers, so the fit is testable on a
// page drawn by the test itself; `fitRuledLines.ts` is the browser edge that gets the
// pixels out of an `<img>`.
//
// Why this exists rather than dragging the corners by hand: the corners are dragged to a
// tenth of a percent at best, and the drawn lines are not evenly spaced — a hand-drawn
// ruling wobbles by a few percent of a band from a straight fit — so even perfectly placed
// corners leave rows a few percent off their lines, which the highlight wash makes
// visible. Measuring the drawing gets both: the corners exactly, and where every line
// actually is.

/** A block of RGBA pixels, row-major — what `getImageData` returns, or a test draws. */
export interface PixelGrid {
  width: number
  height: number
  data: ArrayLike<number>
}

/** The geometry a fit produces: corners, band count and where each band's foot falls. */
export interface RuledFit {
  quad: Quad
  rows: number
  lines: number[]
}

export type RuledFitResult = { ok: true; fit: RuledFit } | { ok: false; reason: string }

/** One drawn line, as the least-squares `y = m·x + c` through its pixels and its x-extent. */
interface DrawnLine {
  m: number
  c: number
  x0: number
  x1: number
}

/** A near-vertical edge of the writing area, as `x = m·y + c`. */
interface Edge {
  m: number
  c: number
}

/**
 * The blue of a ruled line: blue well above red, and green above red too, so a cyan or a
 * royal-blue rule both count while the cream page, the black ink and a gold spiral do not.
 */
export function isRuleInk(r: number, g: number, b: number): boolean {
  return b > 120 && b > r + 50 && g > r + 20
}

/** The red of a margin line. */
export function isMarginInk(r: number, g: number, b: number): boolean {
  return r > 170 && g < 90 && b < 90
}

/** How much of the sampled width a row must be blue across to count as part of a rule. */
const RULE_ROW_MIN = 0.2
/** A row is part of a rule when it is this fraction of the bluest row. */
const RULE_ROW_THRESHOLD = 0.35
/** A run of blue rows taller than this fraction of the picture is a block, not a line. */
const RULE_MAX_THICKNESS = 0.05
/** A margin line has to span this fraction of the picture's height to be one. */
const MARGIN_MIN_SPAN = 0.15
/** A line whose right end falls short of the longest by more than this is occluded. */
const FULL_LINE_RATIO = 0.97

function yOn(line: DrawnLine, x: number): number {
  return line.m * x + line.c
}

function xOn(edge: Edge, y: number): number {
  return edge.m * y + edge.c
}

/** Where a drawn line crosses a near-vertical edge, in px. Two passes settle a slant. */
function crossing(line: DrawnLine, edge: Edge): [number, number] {
  let x = xOn(edge, line.c)
  let y = yOn(line, x)
  x = xOn(edge, y)
  y = yOn(line, x)
  return [x, y]
}

/** Least-squares `x = m·y + c` through points, or a vertical through their mean x. */
function fitEdge(points: [number, number][]): Edge {
  const n = points.length
  let sx = 0
  let sy = 0
  let syy = 0
  let sxy = 0
  for (const [x, y] of points) {
    sx += x
    sy += y
    syy += y * y
    sxy += x * y
  }
  const den = n * syy - sy * sy
  if (n < 2 || Math.abs(den) < 1e-9) return { m: 0, c: sx / Math.max(1, n) }
  const m = (n * sxy - sx * sy) / den
  return { m, c: (sx - m * sy) / n }
}

/** The y-runs where blue spans most of the sampled width: one per drawn line. */
function ruleRuns(px: PixelGrid, x0: number, x1: number): [number, number][] {
  const { width, height, data } = px
  const counts = new Array<number>(height).fill(0)
  let peak = 0
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      if (isRuleInk(data[i]!, data[i + 1]!, data[i + 2]!)) n++
    }
    counts[y] = n
    if (n > peak) peak = n
  }
  if (peak < (x1 - x0) * RULE_ROW_MIN) return []
  const thr = peak * RULE_ROW_THRESHOLD
  const runs: [number, number][] = []
  let y = 0
  while (y < height) {
    if (counts[y]! > thr) {
      const s = y
      while (y < height && counts[y]! > thr) y++
      runs.push([s, y])
    } else {
      y++
    }
  }
  return runs
}

/** The line through every blue pixel in a run of rows, across the whole width. */
function fitLine(px: PixelGrid, s: number, e: number): DrawnLine | null {
  const { width, data } = px
  let n = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  let x0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  for (let y = s; y < e; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (!isRuleInk(data[i]!, data[i + 1]!, data[i + 2]!)) continue
      n++
      sx += x
      sy += y
      sxx += x * x
      sxy += x * y
      if (x < x0) x0 = x
      if (x > x1) x1 = x
    }
  }
  const den = n * sxx - sx * sx
  if (n < 2 || Math.abs(den) < 1e-9) return null
  const m = (n * sxy - sx * sy) / den
  // Pixel centres, not edges: a rule two rows thick at rows 10 and 11 is centred on 11.
  return { m, c: (sy - m * sx) / n + 0.5, x0, x1: x1 + 1 }
}

/** The red margin line through the left half of the picture, or null when there is none. */
function marginEdge(px: PixelGrid): Edge | null {
  const { width, height, data } = px
  const points: [number, number][] = []
  const half = Math.floor(width / 2)
  for (let y = 0; y < height; y++) {
    let n = 0
    let sx = 0
    for (let x = 0; x < half; x++) {
      const i = (y * width + x) * 4
      if (isMarginInk(data[i]!, data[i + 1]!, data[i + 2]!)) {
        n++
        sx += x
      }
    }
    if (n > 0) points.push([sx / n + 0.5, y + 0.5])
  }
  if (points.length < height * MARGIN_MIN_SPAN) return null
  return fitEdge(points)
}

/**
 * The right edge of the writing area: through the right ends of the lines that reach
 * furthest. A line ending well short of the others is one the drawing covers — the hand
 * over the notepad — and its end is not the page's.
 */
function rightEdge(lines: DrawnLine[]): Edge {
  const longest = Math.max(...lines.map(l => l.x1))
  const full = lines.filter(l => l.x1 >= longest * FULL_LINE_RATIO)
  return fitEdge(full.map(l => [l.x1, yOn(l, l.x1)]))
}

/** The left edge when there is no margin line: through the lines' left ends. */
function leftEdgeOfLines(lines: DrawnLine[]): Edge {
  const shortest = Math.min(...lines.map(l => l.x0))
  const full = lines.filter(l => l.x0 <= shortest + (Math.max(...lines.map(l => l.x1)) - shortest) * (1 - FULL_LINE_RATIO))
  return fitEdge(full.map(l => [l.x0, yOn(l, l.x0)]))
}

/**
 * Find the ruling in a picture and state it as a surface: corners in % of the picture,
 * one band per drawn line, and where each line falls in the surface's own space.
 *
 * The bands are the ruled lines: the surface's **bottom edge sits on the last line** and
 * its **top edge one band above the first**, so the first band — the heading, when there
 * is one — writes on the first line the way a hand does, and every line carries a row.
 * The left edge is the red margin line where the picture has one and the lines' own left
 * ends where it does not; the right edge is where the lines stop.
 *
 * The `lines` are not the drawn positions but their pull-back through the quad's own
 * homography ({@link invertHomography}): under perspective, equal steps in the surface are
 * not equal steps in the picture, so the list has to be stated where the renderer lays
 * rows out for the forward map to land each one on its line.
 */
export function detectRuledLines(px: PixelGrid): RuledFitResult {
  const { width, height } = px
  if (width < 2 || height < 2) return { ok: false, reason: 'The picture has no pixels to read.' }

  const runs = ruleRuns(px, Math.floor(width * 0.15), Math.floor(width * 0.85))
    .filter(([s, e]) => e - s <= height * RULE_MAX_THICKNESS)
  const lines = runs.map(([s, e]) => fitLine(px, s, e)).filter((l): l is DrawnLine => l !== null)
  if (lines.length < 2) {
    return { ok: false, reason: 'No ruled lines found: the fit needs at least two blue lines across the picture.' }
  }
  if (lines.length > ROW_COUNT.max) {
    return { ok: false, reason: `Found ${lines.length} lines, more than the ${ROW_COUNT.max} bands a surface can hold.` }
  }

  const left = marginEdge(px) ?? leftEdgeOfLines(lines)
  const right = rightEdge(lines)
  const first = lines[0]!
  const second = lines[1]!
  const last = lines[lines.length - 1]!

  // One band above the first line, measured at each edge so a ruling that converges
  // keeps converging above its first line.
  const topAt = (edge: Edge): [number, number] => {
    const [, y0] = crossing(first, edge)
    const [, y1] = crossing(second, edge)
    const y = y0 - (y1 - y0)
    return [xOn(edge, y), y]
  }
  const cornersPx: [number, number][] = [
    topAt(left),
    topAt(right),
    crossing(last, right),
    crossing(last, left),
  ]
  const forward = unitHomography(cornersPx)
  const inverse = forward && invertHomography(forward)
  if (!forward || !inverse) return { ok: false, reason: 'The ruled area has no interior to fit a surface to.' }

  // Each line's foot in the surface's space: the mean of its two ends pulled back, so a
  // residual slant against the edges is split rather than taken from one side.
  const feet = lines.slice(0, -1).map(line => {
    const [lx, ly] = crossing(line, left)
    const [rx, ry] = crossing(line, right)
    return (applyHomography(inverse, lx, ly)[1] + applyHomography(inverse, rx, ry)[1]) / 2
  })
  const bounds = [0, ...feet, 1]
  if (!bounds.every((v, i) => i === 0 || v > bounds[i - 1]!)) {
    return { ok: false, reason: 'The lines found are not in order down the page.' }
  }

  const quad = cornersPx.map(([x, y]) => [(x / width) * 100, (y / height) * 100]) as Quad
  return { ok: true, fit: { quad, rows: lines.length, lines: bounds } }
}
