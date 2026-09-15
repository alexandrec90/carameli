import { describe, expect, it } from 'vitest'

import {
  drawLoadingGrid,
  gridDotRadius,
  gridInk,
  GRID_ALPHA,
  GRID_PAPER,
  GRID_REST_R,
  GRID_SPACING,
  GRID_SPOT_R,
} from '../../skins/comic-book/benDayGrid'
import {
  drawMarginGrid,
  drawWash,
  letterboxBands,
} from '../../skins/comic-book/benDayWash'
import { pageSheet } from '../../skins/comic-book/MarginGrid'
import { frameRect, OUTER_M, PAGE_ASPECT } from '../../skins/comic-book/panelGeometry'
import type { Rect } from '../../skins/comic-book/panelGeometry'
import { SPOT_OFF, SPOT_REACH, spotlightAt } from '../../skins/comic-book/spotlight'
import type { SpotlightState } from '../../skins/comic-book/spotlight'

// The letterbox grid's geometry: which bands it paints, that the dots it draws there are
// the loading screen's own under the same light, and that the sheet between them stays
// clear. The loop that drives it is MarginGrid.test.tsx; the light is spotlight.test.ts.

// ── Windows of three shapes ──────────────────────────────────────────────────

/** Wider than the landscape page: bands left and right. */
const WIDE = { w: 1920, h: 800 }
/** Taller than the portrait page: bands above and below. */
const TALL = { w: 600, h: 1200 }
/** Exactly the landscape page plus its margin: no bands at all. */
const EXACT = { w: 2 * OUTER_M + 1600, h: 2 * OUTER_M + 1000 }

/** A settled light on the left band of the wide window, on a grid centre. */
const LEFT_LIT: SpotlightState = { x: 90, y: 390, presence: 1 }

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

/**
 * Arcs are recorded at fill time with the style then set: the field goes down as one
 * path under one style — every dot the same ink, whatever the light is doing to its
 * size — and only the wash's gated dots carry a style of their own.
 */
function recorder(): Recorder {
  let fillStyle = ''
  let pathRects: Rect[] = []
  let pathArcs: Array<Omit<Arc, 'style'>> = []
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
    beginPath: () => { pathRects = []; pathArcs = [] },
    moveTo: () => {},
    rect: (x: number, y: number, w: number, h: number) => { pathRects.push({ x, y, w, h }) },
    clip: () => { rec.clips.push(...pathRects) },
    arc: (x: number, y: number, r: number) => { pathArcs.push({ x, y, r }) },
    fill: () => {
      for (const a of pathArcs) rec.arcs.push({ ...a, style: fillStyle })
      pathArcs = []
    },
    save: () => { rec.saves += 1 },
    restore: () => { rec.restores += 1 },
  }
  rec.ctx = ctx as unknown as CanvasRenderingContext2D
  return rec
}

const inside = (p: { x: number; y: number }, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

const area = (r: Rect) => r.w * r.h

const alphaOf = (style: string) => Number(style.slice(style.lastIndexOf(',') + 1, -1))

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
    // alone, or the alpha dots draw them twice and darker.
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

// ── drawMarginGrid ───────────────────────────────────────────────────────────

describe('drawMarginGrid', () => {
  it('clears and draws nothing on a viewport the sheet fills', () => {
    const rec = recorder()
    const drawn = drawMarginGrid(
      rec.ctx, EXACT.w, EXACT.h, pageSheet(frameRect(EXACT.w, EXACT.h)), LEFT_LIT, '#FFE033',
    )
    expect(drawn).toBe(false)
    expect(rec.cleared).toBe(1)
    expect(rec.arcs).toEqual([])
    expect(rec.fills).toEqual([])
  })

  it('papers and clips to the bands, and leaves the sheet clear', () => {
    const rec = recorder()
    const sheet = pageSheet(frameRect(WIDE.w, WIDE.h))
    const drawn = drawMarginGrid(rec.ctx, WIDE.w, WIDE.h, sheet, LEFT_LIT, '#FFE033')
    const bands = letterboxBands(WIDE.w, WIDE.h, sheet)

    expect(drawn).toBe(true)
    expect(rec.clips).toEqual(bands)
    expect(rec.fills.map(f => ({ x: f.x, y: f.y, w: f.w, h: f.h }))).toEqual(bands)
    expect(rec.fills.every(f => f.style === GRID_PAPER)).toBe(true)
    expect(rec.saves).toBe(1)
    expect(rec.restores).toBe(1)
    // Every dot is in a band, or close enough to one that its disc reaches in.
    const reach = GRID_SPOT_R + 1e-6
    for (const a of rec.arcs) {
      expect(bands.some(b => inside(a, {
        x: b.x - reach, y: b.y - reach, w: b.w + 2 * reach, h: b.h + 2 * reach,
      }))).toBe(true)
    }
  })

  it('draws the loading grid\'s own dots — same grid, size and colour under one light', () => {
    const sheet = pageSheet(frameRect(TALL.w, TALL.h))
    // A light on the top band, so the comparison covers lit dots and resting ones.
    const spot: SpotlightState = { x: 300, y: 40, presence: 1 }
    const loading = recorder()
    drawLoadingGrid(loading.ctx, TALL.w, TALL.h, spot, '#E8003D')
    const margin = recorder()
    drawMarginGrid(margin.ctx, TALL.w, TALL.h, sheet, spot, '#E8003D')

    const key = (a: Arc) => `${a.x},${a.y}`
    const byCentre = new Map(loading.arcs.map(a => [key(a), a]))
    expect(margin.arcs.length).toBeGreaterThan(0)
    let litSeen = 0
    for (const a of margin.arcs) {
      // On the loading screen's grid, at the radius and in the colour it drew there. A
      // light measured from the band's own origin rather than the viewport's would put a
      // seam down the letterbox the moment the loading sheet washed away.
      expect((a.x - GRID_SPACING / 2) % GRID_SPACING).toBe(0)
      expect(byCentre.get(key(a))?.r).toBe(a.r)
      expect(byCentre.get(key(a))?.style).toBe(a.style)
      if (a.r > GRID_REST_R) litSeen += 1
    }
    expect(litSeen).toBeGreaterThan(0)
    // And every loading dot in a band is here — none of the margin goes blank.
    const bands = letterboxBands(TALL.w, TALL.h, sheet)
    const drawn = new Set(margin.arcs.map(key))
    for (const a of loading.arcs) {
      if (bands.some(b => inside(a, b))) expect(drawn.has(key(a))).toBe(true)
    }
  })

  it('draws every band in the one colour, whichever pass a dot falls in', () => {
    const rec = recorder()
    const sheet = pageSheet(frameRect(WIDE.w, WIDE.h))
    drawMarginGrid(rec.ctx, WIDE.w, WIDE.h, sheet, SPOT_OFF, '#00AEEF')
    const left = rec.arcs.filter(a => a.x < sheet.x)
    const right = rec.arcs.filter(a => a.x > sheet.x + sheet.w)
    expect(left.length).toBeGreaterThan(0)
    expect(right.length).toBeGreaterThan(0)
    expect(new Set(rec.arcs.map(a => a.style)).size).toBe(1)
    expect(rec.arcs[0].style).toBe(`rgba(${gridInk('#00AEEF').join(',')},${GRID_ALPHA})`)
  })
})

// ── The light reaches the drawn sheet ────────────────────────────────────────

describe('the grid is lit by the spotlight', () => {
  it('rests as one small print in full ink with the light out', () => {
    const rec = recorder()
    drawLoadingGrid(rec.ctx, 400, 300, SPOT_OFF, '#FFE033')
    expect(rec.arcs).toHaveLength(20 * 15)
    for (const a of rec.arcs) {
      expect(a.r).toBe(GRID_REST_R)
      expect(alphaOf(a.style)).toBe(GRID_ALPHA)
    }
  })

  /* The grid is a print, and a print does not brighten where you look at it. Every dot
     on the sheet is the same ink — the only thing the light touches is the size — so a
     pointer nowhere near the corner leaves the corner as readable as the pool. */
  it('prints the whole sheet in one flat ink, lit and unlit alike', () => {
    const rec = recorder()
    drawLoadingGrid(rec.ctx, 800, 600, LEFT_LIT, '#FFE033')
    const ink = `rgba(${gridInk('#FFE033').join(',')},${GRID_ALPHA})`
    expect(new Set(rec.arcs.map(a => a.style))).toEqual(new Set([ink]))
    expect(new Set(rec.arcs.map(a => a.r)).size).toBeGreaterThan(1)
  })

  it('swells the dot under the light to its fullest and the rest by their distance', () => {
    // The wiring check: spotlight.test.ts holds the falloff, this holds that the draw
    // path spends it, dot for dot.
    const rec = recorder()
    drawLoadingGrid(rec.ctx, 800, 600, LEFT_LIT, '#FFE033')
    const at = (x: number, y: number) => rec.arcs.find(a => a.x === x && a.y === y)
    expect(at(90, 390)?.r).toBe(GRID_SPOT_R)
    for (const a of rec.arcs) {
      expect(a.r).toBeCloseTo(gridDotRadius(spotlightAt(LEFT_LIT, a.x, a.y)), 9)
    }
  })

  it('lights a pool the reach wide and leaves the grid beyond it at rest', () => {
    const rec = recorder()
    drawLoadingGrid(rec.ctx, 1200, 800, { x: 610, y: 410, presence: 1 }, '#0057B8')
    const lit = rec.arcs.filter(a => a.r > GRID_REST_R)
    const resting = rec.arcs.filter(a => a.r === GRID_REST_R)
    expect(lit.length).toBeGreaterThan(50)
    expect(resting.length).toBeGreaterThan(lit.length)
    for (const a of lit) expect(Math.hypot(a.x - 610, a.y - 410)).toBeLessThan(SPOT_REACH)
    for (const a of resting) expect(Math.hypot(a.x - 610, a.y - 410)).toBeGreaterThanOrEqual(SPOT_REACH)
  })

  it('eases the whole pool back to the resting print as the light goes out', () => {
    const full = recorder()
    drawLoadingGrid(full.ctx, 400, 400, LEFT_LIT, '#FFE033')
    const half = recorder()
    drawLoadingGrid(half.ctx, 400, 400, { ...LEFT_LIT, presence: 0.5 }, '#FFE033')
    const centreFull = full.arcs.find(a => a.x === 90 && a.y === 390)
    const centreHalf = half.arcs.find(a => a.x === 90 && a.y === 390)
    expect(centreHalf?.r).toBeLessThan(centreFull?.r ?? 0)
    expect(centreHalf?.r).toBeGreaterThan(GRID_REST_R)
    // A half-present light is a smaller dot in the same ink, not a fainter one.
    expect(centreHalf?.style).toBe(centreFull?.style)
  })

  it('carries the light onto the wash sheet, gated to where the sheet is solid', () => {
    // Mid-cover: the sheet is solid behind the front and absent ahead of it. Grid dots
    // appear only on the solid part, lit exactly as the loading screen lights them.
    const rec = recorder()
    drawWash(rec.ctx, 800, 600, 0.5, 0, LEFT_LIT, '#FFE033')
    const grid = rec.arcs.filter(a => a.style.startsWith('rgba('))
    expect(grid.length).toBeGreaterThan(0)
    expect(grid.length).toBeLessThan(40 * 30)
    const paper = rec.arcs.filter(a => a.style === GRID_PAPER)
    expect(paper.length).toBeGreaterThan(grid.length)
    const loading = recorder()
    drawLoadingGrid(loading.ctx, 800, 600, LEFT_LIT, '#FFE033')
    const byCentre = new Map(loading.arcs.map(a => [`${a.x},${a.y}`, a]))
    for (const a of grid) {
      expect(a.r).toBe(byCentre.get(`${a.x},${a.y}`)?.r)
      expect(alphaOf(a.style)).toBeLessThanOrEqual(alphaOf(byCentre.get(`${a.x},${a.y}`)?.style ?? ''))
    }
  })
})
