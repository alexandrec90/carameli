import { describe, expect, it } from 'vitest'

import {
  drawLoadingGrid,
  gridDotRadius,
  gridInk,
  GRID_ALPHA,
  GRID_PAPER,
  GRID_REST_R,
  GRID_SPOT_R,
} from '../../skins/comic-book/benDayGrid'
import { drawWash } from '../../skins/comic-book/benDayWash'
import { SPOT_OFF, SPOT_REACH, spotlightAt } from '../../skins/comic-book/spotlight'
import type { SpotlightState } from '../../skins/comic-book/spotlight'

// What the paper's grid draws under the light: one flat ink whose dots the spotlight
// only resizes, and the same dots carried onto the wash sheet. The light itself is
// spotlight.test.ts; the loop that keeps the paper painted is skinLoadingGrid.test.tsx.

/** A settled light on a grid centre. */
const LEFT_LIT: SpotlightState = { x: 90, y: 390, presence: 1 }

// ── A context that records what was drawn ────────────────────────────────────

interface Arc { x: number; y: number; r: number; style: string }

interface Recorder {
  ctx: CanvasRenderingContext2D
  arcs: Arc[]
}

/**
 * Arcs are recorded at fill time with the style then set: the field goes down as one
 * path under one style — every dot the same ink, whatever the light is doing to its
 * size — and only the wash's gated dots carry a style of their own.
 */
function recorder(): Recorder {
  let fillStyle = ''
  let pathArcs: Array<Omit<Arc, 'style'>> = []
  const rec: Recorder = { ctx: undefined as unknown as CanvasRenderingContext2D, arcs: [] }
  const ctx = {
    get fillStyle() { return fillStyle },
    set fillStyle(v: string) { fillStyle = v },
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => { pathArcs = [] },
    moveTo: () => {},
    arc: (x: number, y: number, r: number) => { pathArcs.push({ x, y, r }) },
    fill: () => {
      for (const a of pathArcs) rec.arcs.push({ ...a, style: fillStyle })
      pathArcs = []
    },
  }
  rec.ctx = ctx as unknown as CanvasRenderingContext2D
  return rec
}

const alphaOf = (style: string) => Number(style.slice(style.lastIndexOf(',') + 1, -1))

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
    // appear only on the solid part, lit exactly as the paper lights them.
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
