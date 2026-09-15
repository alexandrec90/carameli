import { describe, expect, it } from 'vitest'

import {
  detectRuledLines,
  isMarginInk,
  isRuleInk,
} from '../../skins/comic-book/editor/ruledLines'
import { ROW_COUNT, validLines } from '../../skins/comic-book/tableData'
import {
  applyHomography,
  invertHomography,
  quadPx,
  unitHomography,
} from '../../skins/comic-book/tableProjection'
import type { Quad } from '../../skins/comic-book/tableProjection'
import { drawnY, ruledPage } from './ruledPage'
import type { RuledPageSpec } from './ruledPage'

// The ruled-line fit, checked the one way that matters: push every band's foot the fit
// produced through the quad it produced, and land on the line the test drew. The corners
// and the row count are checked on the way, but that projection is the claim — a fit that
// got the corners right and the feet wrong is a table whose rows are nearly on the lines,
// which is the failure the whole thing exists to remove.

const W = 600
const H = 800

/** A page ruled evenly: 12 lines, 50 px apart, a margin at x = 90, rules from 40 to 560. */
function evenPage(over: Partial<RuledPageSpec> = {}): RuledPageSpec {
  return {
    width: W,
    height: H,
    lineYs: Array.from({ length: 12 }, (_, k) => 150 + 50 * k),
    margin: 90,
    lineLeft: 40,
    lineRight: 560,
    ...over,
  }
}

/** A page whose ruling bows the way a drawn one does: pitch drifting from 48 to 53 px. */
function unevenPage(): RuledPageSpec {
  const ys: number[] = [150]
  const pitches = [48, 49, 49, 50, 51, 52, 53, 52, 51, 50, 49]
  for (const p of pitches) ys.push(ys[ys.length - 1]! + p)
  return evenPage({ lineYs: ys })
}

/** Where the fit's band `k` foot lands in the picture, at fraction `u` across the surface. */
function footInPicture(fit: { quad: Quad; lines: number[] }, k: number, u: number): [number, number] {
  const m = unitHomography(quadPx(fit.quad, W, H))!
  return applyHomography(m, u, fit.lines[k + 1]!)
}

function fitOf(spec: RuledPageSpec) {
  const result = detectRuledLines(ruledPage(spec))
  if (!result.ok) throw new Error(result.reason)
  return result.fit
}

describe('ink classifiers', () => {
  it('tell a ruled line and a margin line from the page and from each other', () => {
    expect(isRuleInk(60, 170, 220)).toBe(true)
    expect(isRuleInk(250, 240, 200)).toBe(false)
    expect(isMarginInk(220, 30, 40)).toBe(true)
    expect(isMarginInk(60, 170, 220)).toBe(false)
    expect(isRuleInk(220, 30, 40)).toBe(false)
  })
})

describe('detectRuledLines', () => {
  it('gives the surface one band per drawn line', () => {
    const fit = fitOf(evenPage())
    expect(fit.rows).toBe(12)
    expect(fit.lines).toHaveLength(13)
    expect(validLines(fit.lines, fit.rows)).toBe(true)
  })

  /*
   * The top edge is one band *above* the first line, not on it: the first band is where
   * the heading writes, and a hand writing on a pad puts its first line of lettering on
   * the first rule. The bottom edge is on the last line. The left is the margin line and
   * the right is where the rules stop.
   */
  it('puts the corners on the ruled area, a band above the first line', () => {
    const spec = evenPage()
    const { quad } = fitOf(spec)
    const px = quadPx(quad, W, H)
    const [tl, tr, br, bl] = px as [number, number][]
    expect(tl![0]).toBeCloseTo(90, 0)
    expect(tl![1]).toBeCloseTo(100, 0)
    expect(tr![0]).toBeCloseTo(560, 0)
    expect(tr![1]).toBeCloseTo(100, 0)
    expect(br![0]).toBeCloseTo(560, 0)
    expect(br![1]).toBeCloseTo(700, 0)
    expect(bl![0]).toBeCloseTo(90, 0)
    expect(bl![1]).toBeCloseTo(700, 0)
  })

  it('states the corners in % of the picture, the space the quad is measured in', () => {
    const { quad } = fitOf(evenPage())
    expect(quad[0][0]).toBeCloseTo((90 / W) * 100, 1)
    expect(quad[3][1]).toBeCloseTo((700 / H) * 100, 1)
  })

  it('lands every band foot on the line it was drawn at', () => {
    const spec = evenPage()
    const fit = fitOf(spec)
    for (let k = 0; k < fit.rows; k++) {
      for (const u of [0.1, 0.5, 0.9]) {
        const [x, y] = footInPicture(fit, k, u)
        expect(Math.abs(y - drawnY(spec, k, x)), `line ${k} at u=${u}`).toBeLessThan(0.75)
      }
    }
  })

  /*
   * The reason the feet are recorded at all: a drawn ruling is not even, and no placement
   * of four corners can put equal bands on uneven lines. Every foot still lands on its
   * line here, and the list is visibly not equal division.
   */
  it('follows a ruling that is not evenly spaced', () => {
    const spec = unevenPage()
    const fit = fitOf(spec)
    for (let k = 0; k < fit.rows; k++) {
      const [x, y] = footInPicture(fit, k, 0.5)
      expect(Math.abs(y - drawnY(spec, k, x)), `line ${k}`).toBeLessThan(0.75)
    }
    const equal = fit.lines.map((_, i) => i / fit.rows)
    const worst = Math.max(...fit.lines.map((v, i) => Math.abs(v - equal[i]!)))
    expect(worst).toBeGreaterThan(0.005)
  })

  it('follows a ruling drawn on a slant', () => {
    const spec = evenPage({ slope: -0.02 })
    const fit = fitOf(spec)
    for (let k = 0; k < fit.rows; k++) {
      for (const u of [0.1, 0.9]) {
        const [x, y] = footInPicture(fit, k, u)
        expect(Math.abs(y - drawnY(spec, k, x)), `line ${k} at u=${u}`).toBeLessThan(1)
      }
    }
  })

  it('takes the left edge from the lines themselves when there is no margin line', () => {
    const { quad } = fitOf(evenPage({ margin: null }))
    expect(quadPx(quad, W, H)[0]![0]).toBeCloseTo(40, 0)
    expect(quadPx(quad, W, H)[3]![0]).toBeCloseTo(40, 0)
  })

  // The hand over the notepad covers the right ends of the lower lines. The page's right
  // edge is where the *uncovered* lines stop, not where the hand starts.
  it('ignores the lines a drawing covers when placing the right edge', () => {
    const { quad } = fitOf(evenPage({ coveredFrom: { fromLine: 7, x: 380 } }))
    expect(quadPx(quad, W, H)[1]![0]).toBeCloseTo(560, 0)
    expect(quadPx(quad, W, H)[2]![0]).toBeCloseTo(560, 0)
  })

  it('says why when the picture has no ruling on it', () => {
    const blank = ruledPage(evenPage({ lineYs: [] }))
    const result = detectRuledLines(blank)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/No ruled lines/)
  })

  it('needs two lines to know the pitch above the first', () => {
    const result = detectRuledLines(ruledPage(evenPage({ lineYs: [300] })))
    expect(result.ok).toBe(false)
  })

  it('refuses a ruling with more lines than a surface can hold', () => {
    const many = Array.from({ length: ROW_COUNT.max + 1 }, (_, k) => 20 + 12 * k)
    const result = detectRuledLines(ruledPage(evenPage({ lineYs: many })))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(String(ROW_COUNT.max))
  })

  it('refuses a picture with nothing in it', () => {
    expect(detectRuledLines({ width: 0, height: 0, data: [] }).ok).toBe(false)
  })
})

/*
 * The map back from the picture onto the surface, which is what lets a line found in
 * pixels be recorded where the renderer lays rows out. Checked as a round trip through
 * a quad with real perspective in it — the far edge shorter than the near one — because
 * that is the case where a plain proportional guess would miss.
 */
describe('invertHomography', () => {
  const TILTED: Quad = [[20, 30], [80, 25], [95, 90], [5, 85]]

  it('undoes the forward map at the corners and in the middle', () => {
    const pts = quadPx(TILTED, 400, 300)
    const m = unitHomography(pts)!
    const inv = invertHomography(m)!
    const unit: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0.2, 0.7]]
    for (const [u, v] of unit) {
      const [x, y] = applyHomography(m, u, v)
      const [bu, bv] = applyHomography(inv, x, y)
      expect(bu).toBeCloseTo(u, 9)
      expect(bv).toBeCloseTo(v, 9)
    }
  })

  it('is null for a map with no inverse', () => {
    expect(invertHomography([0, 0, 0, 0, 0, 0, 0, 0])).toBeNull()
  })
})
