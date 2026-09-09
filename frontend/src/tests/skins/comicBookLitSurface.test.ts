/**
 * The guardrail for the light a projected surface throws on the thing under the pointer:
 * **a key — or a row — under the pointer is a single uniform colour that glows, and a
 * pressed one is unmistakably brighter.**
 *
 * Outside the editor the number pad's glyphs are painted `transparent` — the picture
 * already shows the keys — so this lighting is the *only* thing that says a key is there
 * and the only thing that acknowledges a press. That makes three properties load-bearing,
 * and each one was wrong in the version this replaced (a 12% fill inside a 45% ring):
 *
 * 1. **Cell and halo are the same colour.** A fill dimmer than the ring around it draws a
 *    border, and a border on a projection reads as a button that was there all along.
 * 2. **The lit state is legible.** A 12% tint of the authored ink over a photograph is
 *    not a hover state, it is a rounding error.
 * 3. **The press outshines the hover.** The press is an answer to the pointer already
 *    being there, so it has to clear the level the pointer alone produced.
 *
 * A fourth was added when the projected table's rows started lighting too: **both
 * surfaces are lit by the same rules, not by two copies of them.** A copy drifts the
 * first time somebody retunes one of the two, and a page that read as one photograph then
 * reads as two — so the file under test is the shared one, and every assertion above is
 * asserted of it once and holds for whatever names itself in these selector lists.
 *
 * jsdom applies no CSS and never runs an animation, so the stylesheet is read as source
 * (see `skinCss.ts`) — the same technique as `comicBookPanelLift.test.tsx`.
 */

import { describe, expect, it } from 'vitest'

import { SKIN_CSS, cssRules } from './skinCss'

const FILE = 'src/skins/comic-book/lit-surface.css'

/** The two surfaces this light is shared by, as the selectors that name them. */
const SURFACES = ['.cb-number-pad-button', '.cb-ptable-glow']

/** The stylesheet, with comments stripped — a comment may say "border" or "12%" freely. */
function litCss(): string {
  return SKIN_CSS[FILE].replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The body of `@keyframes name`, brace-matched so a nested stop block is included. */
function keyframes(name: string): string {
  const css = litCss()
  const at = css.indexOf(`@keyframes ${name}`)
  expect(at, `no @keyframes ${name} in ${FILE}`).toBeGreaterThanOrEqual(0)

  const open = css.indexOf('{', at)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`unterminated @keyframes ${name}`)
}

/**
 * Every `color-mix(… var(--cb-lit-ink …) N%, transparent)` percentage in a block, in
 * source order. That mix is how the whole file expresses ink strength, so the numbers are
 * directly comparable across states.
 */
function inkPercents(block: string): number[] {
  const mix = /color-mix\(\s*in srgb\s*,\s*var\(\s*--cb-lit-ink[^)]*\)\s*(\d+(?:\.\d+)?)%/g
  return [...block.matchAll(mix)].map(m => Number(m[1]))
}

/**
 * Every declaration block of this stylesheet that lights something — one that paints a
 * `background-color` or a `box-shadow` — whichever rule or keyframe stop it is, and
 * whether or not it sits inside `@media (prefers-reduced-motion: reduce)`.
 */
function litBlocks(): { where: string; body: string }[] {
  return cssRules(litCss())
    .filter(r => /background-color\s*:|box-shadow\s*:/.test(r.body))
    .map(r => ({ where: r.selector.replace(/\s+/g, ' '), body: r.body }))
}

describe('a projected surface lights what the pointer is on as one glowing shape', () => {
  // Asserted first, content and all: a stylesheet that resolved to nothing makes every
  // assertion below vacuously true, which is how an earlier `?raw` reader went unnoticed.
  it('finds the shared stylesheet, with its contents', () => {
    expect(Object.keys(SKIN_CSS)).toContain(FILE)
    expect(litCss().trim()).not.toEqual('')
    expect(litBlocks().length).toBeGreaterThan(3)
  })

  it('paints cell and halo in one colour, so no state draws a border', () => {
    const uneven = litBlocks()
      .filter(b => new Set(inkPercents(b.body)).size !== 1)
      .map(b => `${b.where} { ${inkPercents(b.body).join('%, ')}% }`)

    // One distinct percentage per block: the background and the inner stop of the glow
    // are the same ink, so the edge is where a fall-off starts, not a line.
    expect(uneven).toEqual([])
  })

  it('glows under the pointer instead of holding a static tint', () => {
    const hover = cssRules(litCss()).filter(r => /:hover/.test(r.selector))

    // Two rules name :hover — the animated one and the reduced-motion fallback below —
    // and each must also cover :focus-visible, which is the keyboard's hover.
    expect(hover.length).toBeGreaterThanOrEqual(1)
    for (const rule of hover) expect(rule.selector).toContain(':focus-visible')

    const animated = hover.filter(r => /animation\s*:\s*cb-lit-glow/.test(r.body))
    expect(animated).toHaveLength(1)
    expect(animated[0].body).toMatch(/infinite/)
    expect(animated[0].body).toMatch(/alternate/)
  })

  it('lights the thing under the pointer brightly enough to see on a photograph', () => {
    const stops = inkPercents(keyframes('cb-lit-glow'))

    expect(stops.length).toBeGreaterThanOrEqual(2)
    // The dim end of the pulse is the floor, so it never fades back to the tint that made
    // this state unreadable.
    expect(Math.min(...stops)).toBeGreaterThanOrEqual(30)
    // And the pulse actually swings, or `animation` above is decoration on a static state.
    expect(Math.max(...stops)).toBeGreaterThan(Math.min(...stops))
  })

  it('flares brighter on the press than the pointer alone ever gets', () => {
    const press = inkPercents(keyframes('cb-lit-press'))
    const hover = inkPercents(keyframes('cb-lit-glow'))

    expect(press.length).toBeGreaterThanOrEqual(2)
    // Every moment of the press outshines the brightest moment of the hover pulse, so
    // the acknowledgement cannot be mistaken for the pointer arriving.
    expect(Math.min(...press)).toBeGreaterThan(Math.max(...hover))
  })

  it('keeps both states legible when motion is reduced', () => {
    const css = litCss()
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(at, 'no reduced-motion block').toBeGreaterThanOrEqual(0)

    const reduced = cssRules(css.slice(at))
    const still = reduced.filter(r => /animation\s*:\s*none/.test(r.body))

    // Both the hover and the press keep a level to hold — reduced motion removes the
    // breathing, never the only feedback either surface has.
    expect(still.map(r => r.selector.replace(/\s+/g, ' ')).join(' | ')).toMatch(/:hover/)
    expect(still.map(r => r.selector).join(' | ')).toMatch(/:active|is-pressed/)
    for (const rule of still) {
      expect(inkPercents(rule.body).length).toBeGreaterThan(0)
      expect(Math.min(...inkPercents(rule.body))).toBeGreaterThanOrEqual(30)
    }
  })

  /*
   * The reason this file is shared rather than copied, stated as an assertion.
   *
   * Both surfaces have to be in every state's selector list: a key that lights but does
   * not flare, or a row that flares but never breathes, is exactly the drift a second
   * copy of these rules produced on its own. It is a list membership check rather than a
   * comparison of two stylesheets because there is now only one stylesheet — which is the
   * point.
   */
  it('lights both projected surfaces off the same rules', () => {
    const states = cssRules(litCss()).filter(r => /animation\s*:\s*cb-lit-/.test(r.body))
    expect(states).toHaveLength(2)

    for (const rule of states) {
      for (const surface of SURFACES) expect(rule.selector).toContain(surface)
    }
  })

  it('neither surface keeps a private copy of the light', () => {
    const elsewhere = Object.entries(SKIN_CSS)
      .filter(([file]) => file !== FILE)
      .filter(([, css]) => /@keyframes[^{]*(glow|press)|color-mix\([^)]*--cb-lit-ink/.test(css))
      .map(([file]) => file)

    // A second set of lighting keyframes anywhere under the skin is the copy this file
    // exists to have replaced, whichever surface grew it back.
    expect(elsewhere).toEqual([])
  })
})
