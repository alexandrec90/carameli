import { describe, expect, it } from 'vitest'

import { tintSteps } from '../../skins/comic-book/benDayTint'
import {
  drawLoadingRipple,
  drawMarginRipple,
  letterboxBands,
  RIPPLE_BASE_R,
  WASH_PAPER,
  WASH_SPACING,
} from '../../skins/comic-book/benDayWash'
import { pageSheet } from '../../skins/comic-book/MarginRipple'
import { frameRect, OUTER_M, PAGE_ASPECT } from '../../skins/comic-book/panelGeometry'
import type { Rect } from '../../skins/comic-book/panelGeometry'

// The letterbox ripple's geometry: which bands it paints, that the dots it draws there
// are the loading screen's own, and that the sheet between them stays clear. The loop
// that drives it is MarginRipple.test.tsx.

// ── Windows of three shapes ──────────────────────────────────────────────────

/** Wider than the landscape page: bands left and right. */
const WIDE = { w: 1920, h: 800 }
/** Taller than the portrait page: bands above and below. */
const TALL = { w: 600, h: 1200 }
/** Exactly the landscape page plus its margin: no bands at all. */
const EXACT = { w: 2 * OUTER_M + 1600, h: 2 * OUTER_M + 1000 }

// ── A context that records what was drawn ────────────────────────────────────

interface Arc { x: number; y: number; r: number; style: string }

interface Recorder {
  ctx: CanvasRenderingContext2D
  arcs: Arc[]
  fills: Array<Rect & { style: string }>
  clips: Rect[]
  cleared: number
  saves: number
  restores: number
}

function recorder(): Recorder {
  let fillStyle = ''
  let pathRects: Rect[] = []
  // The counters live on the returned object itself, so a caller reads them live.
  const rec: Recorder = {
    ctx: undefined as unknown as CanvasRenderingContext2D,
    arcs: [], fills: [], clips: [], cleared: 0, saves: 0, restores: 0,
  }
  const ctx = {
    get fillStyle() { return fillStyle },
    set fillStyle(v: string) { fillStyle = v },
    clearRect: () => { rec.cleared += 1 },
    fillRect: (x: number, y: number, w: number, h: number) => {
      rec.fills.push({ x, y, w, h, style: fillStyle })
    },
    beginPath: () => { pathRects = [] },
    rect: (x: number, y: number, w: number, h: number) => { pathRects.push({ x, y, w, h }) },
    clip: () => { rec.clips.push(...pathRects) },
    arc: (x: number, y: number, r: number) => { rec.arcs.push({ x, y, r, style: fillStyle }) },
    fill: () => {},
    save: () => { rec.saves += 1 },
    restore: () => { rec.restores += 1 },
  }
  rec.ctx = ctx as unknown as CanvasRenderingContext2D
  return rec
}

const inside = (p: { x: number; y: number }, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

const area = (r: Rect) => r.w * r.h

// ── pageSheet ────────────────────────────────────────────────────────────────

describe('pageSheet', () => {
  it('is the frame grown by its outer margin on every side', () => {
    const f = frameRect(WIDE.w, WIDE.h)
    expect(pageSheet(frameRect(WIDE.w, WIDE.h))).toEqual({
      x: f.x - OUTER_M, y: f.y - OUTER_M, w: f.w + 2 * OUTER_M, h: f.h + 2 * OUTER_M,
    })
  })

  it('fills a viewport of the page aspect exactly', () => {
    expect(pageSheet(frameRect(EXACT.w, EXACT.h))).toEqual({ x: 0, y: 0, w: EXACT.w, h: EXACT.h })
  })

  it('keeps the page aspect of the window shape', () => {
    const f = frameRect(TALL.w, TALL.h)
    expect(f.w / f.h).toBeCloseTo(PAGE_ASPECT.portrait, 6)
  })

  it('wraps the frame it is given, not the one the window would draw', () => {
    // The editor holding portrait in a wide window: the sheet sits round that frame,
    // so the letterbox lands beside it rather than beside a landscape page nobody sees.
    const held = frameRect(WIDE.w, WIDE.h, 'portrait')
    expect(pageSheet(held)).toEqual({
      x: held.x - OUTER_M, y: held.y - OUTER_M, w: held.w + 2 * OUTER_M, h: held.h + 2 * OUTER_M,
    })
    expect(pageSheet(held)).not.toEqual(pageSheet(frameRect(WIDE.w, WIDE.h)))
  })
})

// ── letterboxBands ───────────────────────────────────────────────────────────

describe('letterboxBands', () => {
  it('is empty when the sheet covers the viewport', () => {
    expect(letterboxBands(EXACT.w, EXACT.h, pageSheet(frameRect(EXACT.w, EXACT.h)))).toEqual([])
  })

  it('is a band each side of a wide window, and none above or below', () => {
    const sheet = pageSheet(frameRect(WIDE.w, WIDE.h))
    const bands = letterboxBands(WIDE.w, WIDE.h, sheet)
    expect(bands).toHaveLength(2)
    expect(bands[0]).toEqual({ x: 0, y: 0, w: sheet.x, h: WIDE.h })
    expect(bands[1].x).toBeCloseTo(sheet.x + sheet.w, 6)
    expect(bands[1].h).toBe(WIDE.h)
  })

  it('is a band above and below a tall window', () => {
    const sheet = pageSheet(frameRect(TALL.w, TALL.h))
    const bands = letterboxBands(TALL.w, TALL.h, sheet)
    expect(bands).toHaveLength(2)
    expect(bands[0]).toEqual({ x: 0, y: 0, w: TALL.w, h: sheet.y })
    expect(bands[1].y).toBeCloseTo(sheet.y + sheet.h, 6)
    expect(bands[1].w).toBe(TALL.w)
  })

  it('tiles the letterbox without overlapping', () => {
    // A sheet inset on all four sides: the corners belong to the top and bottom bands
    // alone, or the alpha ripple draws them twice and darker.
    const sheet = { x: 100, y: 50, w: 300, h: 200 }
    const bands = letterboxBands(500, 300, sheet)
    expect(bands).toHaveLength(4)
    const tiled = bands.reduce((sum, b) => sum + area(b), 0)
    expect(tiled).toBeCloseTo(500 * 300 - area(sheet), 6)
    for (const b of bands) {
      expect(b.x + b.w <= sheet.x || b.x >= sheet.x + sheet.w
        || b.y + b.h <= sheet.y || b.y >= sheet.y + sheet.h).toBe(true)
    }
  })

  it('drops a band thinner than a pixel', () => {
    expect(letterboxBands(500, 300, { x: 0.4, y: 0, w: 499.2, h: 300 })).toEqual([])
  })
})

// ── drawMarginRipple ─────────────────────────────────────────────────────────

describe('drawMarginRipple', () => {
  it('clears and draws nothing on a viewport the sheet fills', () => {
    const rec = recorder()
    const drawn = drawMarginRipple(
      rec.ctx, EXACT.w, EXACT.h, pageSheet(frameRect(EXACT.w, EXACT.h)), 1.25, '#FFE033',
    )
    expect(drawn).toBe(false)
    expect(rec.cleared).toBe(1)
    expect(rec.arcs).toEqual([])
    expect(rec.fills).toEqual([])
  })

  it('papers and clips to the bands, and leaves the sheet clear', () => {
    const rec = recorder()
    const sheet = pageSheet(frameRect(WIDE.w, WIDE.h))
    const drawn = drawMarginRipple(rec.ctx, WIDE.w, WIDE.h, sheet, 1.25, '#FFE033')
    const bands = letterboxBands(WIDE.w, WIDE.h, sheet)

    expect(drawn).toBe(true)
    expect(rec.clips).toEqual(bands)
    expect(rec.fills.map(f => ({ x: f.x, y: f.y, w: f.w, h: f.h }))).toEqual(bands)
    expect(rec.fills.every(f => f.style === WASH_PAPER)).toBe(true)
    expect(rec.saves).toBe(1)
    expect(rec.restores).toBe(1)
    // Every dot is in a band, or close enough to one that its disc reaches in.
    const reach = RIPPLE_BASE_R + 1e-6
    for (const a of rec.arcs) {
      expect(bands.some(b => inside(a, {
        x: b.x - reach, y: b.y - reach, w: b.w + 2 * reach, h: b.h + 2 * reach,
      }))).toBe(true)
    }
  })

  it('draws the loading ripple\'s own dots — same grid, size, colour and instant', () => {
    const t = 3.7
    const sheet = pageSheet(frameRect(TALL.w, TALL.h))
    const loading = recorder()
    drawLoadingRipple(loading.ctx, TALL.w, TALL.h, t, '#E8003D')
    const margin = recorder()
    drawMarginRipple(margin.ctx, TALL.w, TALL.h, sheet, t, '#E8003D')

    const key = (a: Arc) => `${a.x},${a.y}`
    const byCentre = new Map(loading.arcs.map(a => [key(a), a]))
    expect(margin.arcs.length).toBeGreaterThan(0)
    for (const a of margin.arcs) {
      // On the loading screen's grid, at the radius and in the tint it drew there. The
      // colour matters as much as the radius now that the lava tint varies with position:
      // a field measured from the band's own origin rather than the viewport's would put
      // a seam down the letterbox the moment the loading sheet washed away.
      expect((a.x - WASH_SPACING / 2) % WASH_SPACING).toBe(0)
      expect(byCentre.get(key(a))?.r).toBe(a.r)
      expect(byCentre.get(key(a))?.style).toBe(a.style)
    }
    // And every loading dot in a band is here — none of the margin goes blank.
    const bands = letterboxBands(TALL.w, TALL.h, sheet)
    const drawn = new Set(margin.arcs.map(key))
    for (const a of loading.arcs) {
      if (bands.some(b => inside(a, b))) expect(drawn.has(key(a))).toBe(true)
    }
  })

  it('paints one colour across a band, whichever band a dot falls in', () => {
    // A wide window's two side bands are drawn by separate passes, each with its own
    // hue cache. The same field must reach the same colour through both.
    const rec = recorder()
    const sheet = pageSheet(frameRect(WIDE.w, WIDE.h))
    drawMarginRipple(rec.ctx, WIDE.w, WIDE.h, sheet, 6.25, '#00AEEF')
    const left = rec.arcs.filter(a => a.x < sheet.x)
    const right = rec.arcs.filter(a => a.x > sheet.x + sheet.w)
    expect(left.length).toBeGreaterThan(0)
    expect(right.length).toBeGreaterThan(0)
    // Mirrored rows of the band pair sit at the same field only by accident, so compare
    // through the tint instead: every colour drawn is one the accent's own swing reaches.
    const swing = new Set<string>()
    for (let field = -1; field <= 1; field += 0.001) swing.add(tintSteps('#00AEEF')(field))
    for (const a of rec.arcs) {
      expect(swing.has(a.style.slice('rgba('.length, a.style.lastIndexOf(',')))).toBe(true)
    }
  })
})

// ── The tint reaches the drawn sheet ─────────────────────────────────────────

describe('the ripple carries the lava tint', () => {
  it('draws more than one hue across a viewport at one instant', () => {
    // The wiring check: benDayTint.test.ts holds the field, this holds that the draw
    // path spends it. A ripple drawn in the flat accent would pass every test there.
    const rec = recorder()
    drawLoadingRipple(rec.ctx, 1920, 1080, 4.5, '#FFE033')
    const hues = new Set(rec.arcs.map(a => a.style.slice(0, a.style.lastIndexOf(','))))
    expect(hues.size).toBeGreaterThan(3)
  })

  it('shifts the hue of a fixed dot as the drift carries on', () => {
    const hueAt = (t: number) => {
      const rec = recorder()
      drawLoadingRipple(rec.ctx, 400, 400, t, '#FFE033')
      const dot = rec.arcs.find(a => a.x === 210 && a.y === 210)
      return dot?.style.slice(0, dot.style.lastIndexOf(','))
    }
    expect(hueAt(0)).toBeDefined()
    expect(hueAt(40)).not.toBe(hueAt(0))
  })
})
