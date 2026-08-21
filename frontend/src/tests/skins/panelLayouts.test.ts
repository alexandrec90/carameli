import { describe, expect, it, vi } from 'vitest'

import { computeClassicLayout } from '../../skins/comic-book/classicLayouts'
import { PANEL_PATTERNS } from '../../skins/comic-book/editor/layoutConfig'
import { computeHomeLayout, computePagePolys } from '../../skins/comic-book/pageLayouts'
import { HG, OUTER_M, SPILL } from '../../skins/comic-book/panelGeometry'
import {
  PANEL_BG_CONFIGS,
  PATTERN_STYLE_KEYS,
  drawPanelBackground,
} from '../../skins/comic-book/panelPatterns'
import { PANELS, pageForPath } from '../../skins/comic-book/panels'

/** Shoelace area of a polygon in viewport coords. */
function area(pts: [number, number][]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

/** Home-page panel indices, derived from PANELS rather than restated. */
const HOME = PANELS.flatMap((p, i) => (p.page === 'home' ? [i] : []))
const CLASSIC = PANELS.flatMap((p, i) => (p.page === 'classic' ? [i] : []))

describe('pageForPath', () => {
  it('shows the 4-panel home grid on the root route only', () => {
    expect(pageForPath('/')).toBe('home')
    expect(pageForPath('/phone-lines')).toBe('classic')
    expect(pageForPath('/extensions')).toBe('classic')
    expect(pageForPath('/sms')).toBe('classic')
    expect(pageForPath('/nonsense')).toBe('classic')
  })
})

describe('computeHomeLayout', () => {
  const LANDSCAPE: [number, number] = [1440, 900]
  const PORTRAIT: [number, number] = [700, 1000]

  it('returns one polygon per home panel', () => {
    expect(computeHomeLayout(...LANDSCAPE)).toHaveLength(HOME.length)
  })

  // The logo was asked for as the smallest panel, at every viewport shape — the
  // portrait split widens it so it never collapses, but never past its siblings.
  it.each([LANDSCAPE, PORTRAIT])('keeps the logo panel smallest at %dx%d', (w, h) => {
    const [logo, ...rest] = computeHomeLayout(w, h).map(p => area(p.vp))
    rest.forEach(other => expect(logo).toBeLessThan(other))
  })

  // The dividers are the visual system shared with the classic grid: none of them
  // vertical or horizontal, so every panel edge along one is slanted.
  it('slants the row divider and both column dividers', () => {
    const [logo, notepad, phone, talk] = computeHomeLayout(...LANDSCAPE)
    // Row divider: bottom edge of the logo panel is not horizontal.
    expect(logo.vp[2][1]).not.toBe(logo.vp[3][1])
    // Row-1 column divider: logo's right edge is not vertical, and notepad's left
    // edge leans the same way.
    expect(logo.vp[1][0]).not.toBe(logo.vp[2][0])
    expect(notepad.vp[0][0]).not.toBe(notepad.vp[3][0])
    // Row-2 column divider: skewed the other way than row 1's.
    const skew1 = logo.vp[2][0] - logo.vp[1][0]
    const skew2 = phone.vp[2][0] - phone.vp[1][0]
    expect(Math.sign(skew1)).not.toBe(Math.sign(skew2))
    expect(talk.vp[3][0]).not.toBe(talk.vp[0][0])
  })

  it('insets each panel a half-gutter from the dividers, leaving a full gutter', () => {
    const [logo, notepad, phone, talk] = computeHomeLayout(...LANDSCAPE)
    // Across the row-1 column divider, top corners sit 2×HG apart.
    expect(notepad.vp[0][0] - logo.vp[1][0]).toBeCloseTo(2 * HG)
    // Across the row divider, the left corners sit 2×HG apart vertically.
    expect(phone.vp[0][1] - logo.vp[3][1]).toBeCloseTo(2 * HG)
    // Across the row-2 column divider.
    expect(talk.vp[0][0] - phone.vp[1][0]).toBeCloseTo(2 * HG)
  })

  it('keeps every polygon inside the outer margin', () => {
    const [w, h] = LANDSCAPE
    for (const p of computeHomeLayout(w, h)) {
      for (const [x, y] of p.vp) {
        expect(x).toBeGreaterThanOrEqual(OUTER_M)
        expect(x).toBeLessThanOrEqual(w - OUTER_M)
        expect(y).toBeGreaterThanOrEqual(OUTER_M)
        expect(y).toBeLessThanOrEqual(h - OUTER_M)
      }
    }
  })

  // Spill is allowed only toward the viewport boundary each corner panel touches,
  // never into the gutters between panels.
  it('lets each corner panel spill outward only', () => {
    const dirs = computeHomeLayout(...LANDSCAPE).map(p => [
      p.spillTop, p.spillRight, p.spillBottom, p.spillLeft,
    ])
    expect(dirs).toEqual([
      [true, false, false, true], // logo — top-left corner
      [true, true, false, false], // notepad — top-right
      [false, false, true, true], // phone — bottom-left
      [false, true, true, false], // conversation — bottom-right
    ])
  })

  it('expands the spill polygon by SPILL on exactly the flagged edges', () => {
    const [logo] = computeHomeLayout(...LANDSCAPE)
    // Top-left panel: TL moves up and left, BR stays put.
    expect(logo.spillVP[0]).toEqual([logo.vp[0][0] - SPILL, logo.vp[0][1] - SPILL])
    expect(logo.spillVP[2]).toEqual(logo.vp[2])
  })
})

describe('computePagePolys', () => {
  it('spreads the home layout into a PANELS-length sparse array', () => {
    const polys = computePagePolys(1440, 900, 'home')
    expect(polys).toHaveLength(PANELS.length)
    HOME.forEach(i => expect(polys[i]).not.toBeNull())
    CLASSIC.forEach(i => expect(polys[i]).toBeNull())
  })

  it('fills only the classic slots for the classic page', () => {
    const polys = computePagePolys(1440, 900, 'classic')
    expect(polys).toHaveLength(PANELS.length)
    CLASSIC.forEach(i => expect(polys[i]).not.toBeNull())
    HOME.forEach(i => expect(polys[i]).toBeNull())
  })

  it('hands each page panel its layout polygon, in order', () => {
    const local = computeHomeLayout(1440, 900)
    const polys = computePagePolys(1440, 900, 'home')
    HOME.forEach((slot, j) => expect(polys[slot]).toEqual(local[j]))
    const classicLocal = computeClassicLayout(1440, 900)
    const classicPolys = computePagePolys(1440, 900, 'classic')
    CLASSIC.forEach((slot, j) => expect(classicPolys[slot]).toEqual(classicLocal[j]))
  })
})

describe('PANELS / PANEL_BG_CONFIGS parallelism', () => {
  it('tunes a background for every panel slot', () => {
    expect(PANEL_BG_CONFIGS).toHaveLength(PANELS.length)
  })
})

describe('drawPanelBackground', () => {
  /**
   * A recording 2D-context stand-in: every method exists and is a spy, and anything a
   * method returns (a gradient) offers addColorStop. jsdom ships no real 2D context,
   * and the draw functions only issue calls — they never read back.
   */
  function stubCtx(): {
    ctx: CanvasRenderingContext2D
    calls: Map<string, ReturnType<typeof vi.fn>>
  } {
    const calls = new Map<string, ReturnType<typeof vi.fn>>()
    const target: Record<string | symbol, unknown> = {}
    const ctx = new Proxy(target, {
      get(t, prop) {
        if (typeof prop === 'string' && !(prop in t)) {
          const fn = vi.fn(() => ({ addColorStop: vi.fn() }))
          calls.set(prop, fn)
          t[prop] = fn
        }
        return t[prop]
      },
      set(t, prop, v) {
        t[prop] = v
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    return { ctx, calls }
  }

  // The reversion check for the dispatch: a style dropped from the switch would clear
  // the canvas and then paint nothing, so "cleared only" is the failure shape.
  it.each(PATTERN_STYLE_KEYS.map(k => [k] as const))('draws dots for %s', style => {
    const { ctx, calls } = stubCtx()
    drawPanelBackground(ctx, 320, 240, style, PANEL_BG_CONFIGS[0], 1.25)
    expect(calls.get('clearRect')).toHaveBeenCalledWith(0, 0, 320, 240)
    expect(calls.get('fillRect')).toHaveBeenCalled()
    expect(calls.get('arc')).toHaveBeenCalled()
  })

  it('draws every shipped panel config under its shipped style without throwing', () => {
    PANEL_BG_CONFIGS.forEach((cfg, i) => {
      const { ctx } = stubCtx()
      expect(() => drawPanelBackground(ctx, 300, 200, PANEL_PATTERNS[i], cfg, 0.4)).not.toThrow()
    })
  })
})
