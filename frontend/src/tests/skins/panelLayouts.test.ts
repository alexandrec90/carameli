import { describe, expect, it, vi } from 'vitest'

import { PANEL_GRIDS, PANEL_PATTERNS } from '../../skins/comic-book/editor/layoutConfig'
import { gridPolys } from '../../skins/comic-book/panelGeometry'
import type { LayoutKind } from '../../skins/comic-book/panelGeometry'
import {
  PANEL_BG_CONFIGS,
  PATTERN_STYLE_KEYS,
  drawPanelBackground,
} from '../../skins/comic-book/panelPatterns'
import { PANELS, pageForPath } from '../../skins/comic-book/panels'

// The page-level behavior on top of the grids: which page a route shows, how a page's
// grid becomes the sparse poly array Layout renders from, and the per-panel background
// painting. The grids' *structure* (conforming seams, frame corners, empty other-page
// rings) is panelGridOps.test.ts territory.

const KINDS: LayoutKind[] = ['landscape', 'portrait', 'square']

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

/** The sparse poly array Layout derives: null where the panel is on the other page. */
function pagePolys(page: 'home' | 'classic', kind: LayoutKind) {
  return gridPolys(PANEL_GRIDS[page][kind], 1440, 900).map(p => (p.vp.length >= 3 ? p : null))
}

describe('pageForPath', () => {
  it('shows the 4-panel home grid on the root route only', () => {
    expect(pageForPath('/')).toBe('home')
    expect(pageForPath('/phone-lines')).toBe('classic')
    expect(pageForPath('/extensions')).toBe('classic')
    expect(pageForPath('/sms')).toBe('classic')
    expect(pageForPath('/nonsense')).toBe('classic')
  })
})

describe('the home page grids', () => {
  it('names exactly four panels, the logo first', () => {
    expect(HOME).toHaveLength(4)
    expect(PANELS[HOME[0]].label).toBe('Logo 2')
  })

  // The logo was asked for as the smallest panel, at every viewport shape.
  it.each(KINDS)('keeps the logo panel smallest in the %s grid', kind => {
    const polys = gridPolys(PANEL_GRIDS.home[kind], 1440, 900)
    const [logo, ...rest] = HOME.map(i => area(polys[i].vp))
    rest.forEach(other => expect(logo).toBeLessThan(other))
  })

  // The dividers are the visual system shared with the classic grid: no seam runs
  // exactly vertical or horizontal, so every panel edge along one is slanted.
  it.each(KINDS)('slants every interior seam of the %s grid', kind => {
    const grid = PANEL_GRIDS.home[kind]
    const interior = grid.vertices.filter(([x, y]) => x > 0 && x < 1 && y > 0 && y < 1)
    expect(interior.length).toBeGreaterThan(0)
    for (const ring of grid.panels) {
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = grid.vertices[ring[i]]
        const [bx, by] = grid.vertices[ring[(i + 1) % ring.length]]
        // A frame edge is axis-aligned by construction; only interior seams are held
        // to the slant rule.
        const onFrame =
          (ax === 0 && bx === 0) || (ax === 1 && bx === 1) || (ay === 0 && by === 0) || (ay === 1 && by === 1)
        if (onFrame) continue
        expect(ax === bx && ay !== by).toBe(false)
        expect(ay === by && ax !== bx).toBe(false)
      }
    }
  })
})

describe('page polys from the grids', () => {
  it('spreads the home grid into a PANELS-length sparse array', () => {
    const polys = pagePolys('home', 'landscape')
    expect(polys).toHaveLength(PANELS.length)
    HOME.forEach(i => expect(polys[i]).not.toBeNull())
    CLASSIC.forEach(i => expect(polys[i]).toBeNull())
  })

  it('fills only the classic slots for the classic page', () => {
    const polys = pagePolys('classic', 'landscape')
    expect(polys).toHaveLength(PANELS.length)
    CLASSIC.forEach(i => expect(polys[i]).not.toBeNull())
    HOME.forEach(i => expect(polys[i]).toBeNull())
  })
})

describe('PANELS / PANEL_BG_CONFIGS parallelism', () => {
  it('tunes a background for every panel slot', () => {
    expect(PANEL_BG_CONFIGS).toHaveLength(PANELS.length)
    expect(PANEL_PATTERNS).toHaveLength(PANELS.length)
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
