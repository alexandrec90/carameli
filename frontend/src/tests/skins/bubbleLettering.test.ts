/**
 * The guardrail for one invariant: **a panel balloon's lettering scales with the window
 * exactly as the balloon's box does.**
 *
 * The box follows the window's width up to the page ratio in `pageFit.ts` and its height
 * past it. The lettering used to be `clamp(0.75rem, 2vw, 1.125rem)`: pinned at 18px from
 * 900px up while the box went on growing, so a balloon drawn at 1920 held its number with
 * room to spare at 2560 and cut it off at 1100. A `vw`-only slope then fixed the narrow
 * end and broke the wide one, growing the words across two monitors while the box was
 * held to the page.
 *
 * The fix is one token, `--cb-lettering`, and this file pins its shape rather than its
 * value: a floor for legibility, a `vw` slope, a `vh` slope that is the same slope times
 * the page ratio, and **no px ceiling**, because a ceiling is exactly where the two scales
 * diverge again. It also pins the slope to the size the balloons were drawn at, so the
 * page at that width is unchanged, and checks that every lettered thing inside a balloon
 * takes the token rather than a size of its own.
 *
 * jsdom applies no CSS, so this reads the stylesheets as source (see skinCss.ts).
 */

import { describe, expect, it } from 'vitest'

import { PAGE_FIT_ASPECT } from '../../skins/comic-book/pageFit'
import { SKIN_CSS, cssRules } from './skinCss'

/** The window width the balloons were laid out at, and the lettering size they got there. */
const DESIGN_WIDTH_PX = 1920
const DESIGN_LETTERING_PX = 18

/** Smallest the lettering may go, in px — below this the balloon face is not legible. */
const FLOOR_PX = 12

/** Everything inside a balloon that letters, and so must share the one token. */
const LETTERED = ['.cb-panel-bubble-text', '.cb-bubble-input', '.cb-bubble-actions']

const ROOT_PX_PER_REM = 16

/** `max(<floor>rem, min(<slope>vw, <slope × ratio>vh))` and nothing else. */
const TOKEN_SHAPE =
  /^max\(\s*([\d.]+)rem\s*,\s*min\(\s*([\d.]+)vw\s*,\s*([\d.]+)vh\s*\)\s*\)$/

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

/** The token's three numbers: floor in rem, the vw slope and the vh slope. */
function tokenParts(): { floorRem: number; slopeVw: number; slopeVh: number } {
  const m = TOKEN_SHAPE.exec(letteringToken())
  expect(m, 'max(<floor>rem, min(<slope>vw, <slope>vh))').not.toBeNull()
  const [, floorRem, slopeVw, slopeVh] = m as RegExpExecArray
  return { floorRem: Number(floorRem), slopeVw: Number(slopeVw), slopeVh: Number(slopeVh) }
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
  it('has a floor, a vw slope and a vh slope, and no px ceiling', () => {
    // A `clamp` would carry the ceiling back in, and a bare `vw` would let the lettering
    // vanish in a narrow window and outgrow the balloons in a wide one.
    const { floorRem, slopeVw, slopeVh } = tokenParts()
    expect(floorRem * ROOT_PX_PER_REM).toBe(FLOOR_PX)
    expect(slopeVw).toBeGreaterThan(0)
    expect(slopeVh).toBeGreaterThan(0)
  })

  it('is the size it always was at the width the balloons were drawn at', () => {
    const { slopeVw } = tokenParts()
    expect((slopeVw / 100) * DESIGN_WIDTH_PX).toBeCloseTo(DESIGN_LETTERING_PX, 6)
  })

  it('stops with the balloons past the page ratio', () => {
    // The vh slope is the vw slope at the ratio where the box switches from following
    // the width to following the height — the one number pageFit.ts owns.
    const { slopeVw, slopeVh } = tokenParts()
    expect(slopeVh).toBeCloseTo(slopeVw * PAGE_FIT_ASPECT, 6)
  })

  it('reaches the floor only below the design width', () => {
    // Otherwise the floor is what every ordinary window sees and the slope never acts.
    const { slopeVw } = tokenParts()
    expect(FLOOR_PX / (slopeVw / 100)).toBeLessThan(DESIGN_WIDTH_PX)
  })

  it.each(LETTERED)('%s letters in the shared token', selector => {
    const sizes = fontSizeOf(selector)
    expect(sizes, `${selector} sets a font-size`).not.toHaveLength(0)
    for (const size of sizes) expect(size).toBe('var(--cb-lettering)')
  })
})
