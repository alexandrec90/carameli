/**
 * The guardrail for one invariant: **a panel balloon's lettering scales with the window
 * exactly as the balloon's box does.**
 *
 * A balloon is placed as a % of its panel and a panel is a share of the viewport, so the
 * box is a linear function of the window width. The lettering used to be
 * `clamp(0.75rem, 2vw, 1.125rem)`: pinned at 18px from 900px up, while the box went on
 * growing. Drawn at 1920, the same balloon then held its number with room to spare at
 * 2560 and cut it off at 1100 — the reader who resized the window watched the balloon
 * and its words part company in both directions.
 *
 * The fix is one token, `--cb-lettering`, and this file pins its shape rather than its
 * value: a floor for legibility, a slope in `vw`, and **no ceiling**, because a ceiling
 * is exactly where the two scales diverge again. It also pins the slope to the size the
 * balloons were drawn at, so the page at that width is unchanged, and checks that every
 * lettered thing inside a balloon takes the token rather than a size of its own.
 *
 * jsdom applies no CSS, so this reads the stylesheets as source (see skinCss.ts).
 */

import { describe, expect, it } from 'vitest'

import { SKIN_CSS, cssRules } from './skinCss'

/** The window width the balloons were laid out at, and the lettering size they got there. */
const DESIGN_WIDTH_PX = 1920
const DESIGN_LETTERING_PX = 18

/** Smallest the lettering may go, in px — below this the balloon face is not legible. */
const FLOOR_PX = 12

/** Everything inside a balloon that letters, and so must share the one token. */
const LETTERED = ['.cb-panel-bubble-text', '.cb-bubble-input', '.cb-bubble-actions']

const ROOT_PX_PER_REM = 16

/** The `--cb-lettering` declaration, wherever in the skin it is made. */
function letteringToken(): string {
  const found: string[] = []
  for (const css of Object.values(SKIN_CSS)) {
    for (const rule of cssRules(css)) {
      const m = /--cb-lettering\s*:\s*([^;]+);/.exec(rule.body)
      if (m) found.push(m[1].trim())
    }
  }
  expect(found, 'one --cb-lettering token, declared once').toHaveLength(1)
  return found[0]
}

/** The `font-size` a selector is given, across every rule that names it alone. */
function fontSizeOf(selector: string): string[] {
  const sizes: string[] = []
  for (const css of Object.values(SKIN_CSS)) {
    for (const rule of cssRules(css)) {
      const names = rule.selector.split(',').map(s => s.trim())
      if (!names.includes(selector)) continue
      const m = /(?:^|[;\s])font-size\s*:\s*([^;]+);/.exec(rule.body)
      if (m) sizes.push(m[1].trim())
    }
  }
  return sizes
}

describe('panel balloon lettering', () => {
  it('has a floor and a vw slope and no ceiling', () => {
    // `max(floor, slope)` and nothing else: a `clamp` would carry the ceiling back in,
    // and a bare `vw` would let the lettering vanish in a narrow window.
    const m = /^max\(\s*([\d.]+)rem\s*,\s*([\d.]+)vw\s*\)$/.exec(letteringToken())
    expect(m, 'max(<floor>rem, <slope>vw)').not.toBeNull()
    const [, floorRem, slopeVw] = m as RegExpExecArray
    expect(Number(floorRem) * ROOT_PX_PER_REM).toBe(FLOOR_PX)
    expect(Number(slopeVw)).toBeGreaterThan(0)
  })

  it('is the size it always was at the width the balloons were drawn at', () => {
    const m = /([\d.]+)vw/.exec(letteringToken()) as RegExpExecArray
    const atDesign = (Number(m[1]) / 100) * DESIGN_WIDTH_PX
    expect(atDesign).toBeCloseTo(DESIGN_LETTERING_PX, 6)
  })

  it('reaches the floor only below the design width', () => {
    // Otherwise the floor is what every ordinary window sees and the slope never acts.
    const m = /([\d.]+)vw/.exec(letteringToken()) as RegExpExecArray
    const floorAt = FLOOR_PX / (Number(m[1]) / 100)
    expect(floorAt).toBeLessThan(DESIGN_WIDTH_PX)
  })

  it.each(LETTERED)('%s letters in the shared token', selector => {
    const sizes = fontSizeOf(selector)
    expect(sizes, `${selector} sets a font-size`).not.toHaveLength(0)
    for (const size of sizes) expect(size).toBe('var(--cb-lettering)')
  })
})
