import { describe, expect, it } from 'vitest'

import {
  contrastRatio,
  gridDotRadius,
  gridInk,
  inkOnPaper,
  parseCssColor,
  relativeLuminance,
  GRID_ALPHA,
  GRID_MIN_CONTRAST,
  GRID_PAPER,
  GRID_REST_R,
  GRID_SPACING,
  GRID_SPOT_R,
} from '../../skins/comic-book/benDayGrid'
import { WASH_MERGE_RADIUS } from '../../skins/comic-book/benDayWash'
import { PAGE_ACCENTS, PAGE_FALLBACK_ACCENT } from '../../skins/comic-book/pageAccent'

// The printed field: that its ink reads on the paper whatever a route accents with, and
// that the light changes a dot's size and nothing else. What each surface draws with it
// is marginGrid.test.ts; the light itself is spotlight.test.ts.

const PAPER_LUMINANCE = relativeLuminance(parseCssColor(GRID_PAPER))

const contrastOnPaper = (rgb: readonly [number, number, number]) =>
  contrastRatio(relativeLuminance(rgb), PAPER_LUMINANCE)

describe('parseCssColor', () => {
  it('parses hex colors to RGB triples', () => {
    expect(parseCssColor('#FFE033')).toEqual([255, 224, 51])
    expect(parseCssColor('#111111')).toEqual([17, 17, 17])
    expect(parseCssColor('#FAFAF2')).toEqual([250, 250, 242])
  })
})

describe('relativeLuminance and contrastRatio', () => {
  it('puts black at 0 and white at 1', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0)
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 6)
  })

  it('spans the WCAG range and is indifferent to the order of its arguments', () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 6)
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 6)
    expect(contrastRatio(0.3, 0.3)).toBe(1)
  })
})

describe('inkOnPaper', () => {
  /* The whole point of the ink: the grid is a print on paper, visible with the pointer
     nowhere near it. `#FFE033` on `#FAFAF2` is 1.3:1 — the invisible grid this replaces. */
  it('darkens a pale accent until it reads on the paper', () => {
    const raw = parseCssColor('#FFE033')
    expect(contrastOnPaper(raw)).toBeLessThan(GRID_MIN_CONTRAST)

    const ink = inkOnPaper(raw)
    expect(contrastOnPaper(ink)).toBeGreaterThanOrEqual(GRID_MIN_CONTRAST)
    for (const [i, channel] of ink.entries()) expect(channel).toBeLessThan(raw[i])
  })

  it('keeps the accent when it already reads, rather than darkening on principle', () => {
    const blue = parseCssColor('#0057B8')
    expect(contrastOnPaper(blue)).toBeGreaterThanOrEqual(GRID_MIN_CONTRAST)
    expect(inkOnPaper(blue)).toEqual(blue)
  })

  it('keeps the hue — the route still prints in its own colour', () => {
    // Channels scaled together, so the ratios between them survive the darkening.
    const [r, g, b] = inkOnPaper([255, 224, 51])
    expect(g / r).toBeCloseTo(224 / 255, 2)
    expect(b / r).toBeCloseTo(51 / 255, 2)
  })

  it('darkens no further than it has to: a shade lighter would fail', () => {
    const ink = inkOnPaper([255, 224, 51])
    const lighter = ink.map(c => c + 2) as [number, number, number]
    expect(contrastOnPaper(lighter)).toBeLessThan(GRID_MIN_CONTRAST)
  })

  it('gives white — the worst case — an ink that still reads', () => {
    expect(contrastOnPaper(inkOnPaper([255, 255, 255]))).toBeGreaterThanOrEqual(GRID_MIN_CONTRAST)
  })
})

describe('gridInk', () => {
  it('prints every route accent at or above the contrast floor', () => {
    for (const accent of [...Object.values(PAGE_ACCENTS), PAGE_FALLBACK_ACCENT]) {
      expect(contrastOnPaper(gridInk(accent))).toBeGreaterThanOrEqual(GRID_MIN_CONTRAST)
    }
  })

  it('answers the same triple every time, so a repaint cannot shift the colour', () => {
    expect(gridInk('#00AEEF')).toEqual(gridInk('#00AEEF'))
    expect(gridInk('#00AEEF')).toEqual(inkOnPaper(parseCssColor('#00AEEF')))
  })
})

describe('gridDotRadius', () => {
  it('rests at the resting radius and is fullest at the centre of the light', () => {
    expect(gridDotRadius(0)).toBe(GRID_REST_R)
    expect(gridDotRadius(1)).toBe(GRID_SPOT_R)
  })

  it('swells with the light, and only swells', () => {
    let prev = gridDotRadius(0)
    for (let lit = 0.1; lit <= 1; lit += 0.1) {
      const r = gridDotRadius(lit)
      expect(r).toBeGreaterThan(prev)
      prev = r
    }
  })

  /* The complaint this answers: dots that were only visible under the cursor. The ink is
     opaque and flat, so a dot outside the light is exactly as dark as the one under it —
     the light is a change of shape, and nothing about the effect can hide the field. */
  it('is the whole of what the light does: the ink never varies', () => {
    expect(GRID_ALPHA).toBe(1)
  })

  it('rests visibly: the resting grid is a print, not a hairline', () => {
    expect(GRID_REST_R).toBeGreaterThanOrEqual(2)
  })

  it('never merges: a lit dot stays clear of its neighbours', () => {
    // The grid has to stay a grid under the light. At half the pitch the dots would
    // touch and the pool would read as a solid blot, not as halftone swelling.
    expect(GRID_SPOT_R).toBeLessThan(GRID_SPACING / 2)
    expect(GRID_SPOT_R).toBeLessThan(WASH_MERGE_RADIUS)
  })
})
