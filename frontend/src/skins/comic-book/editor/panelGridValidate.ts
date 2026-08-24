import type { NormPt, PageGrids, PanelGrid, PanelGrids } from '../panelGeometry'
import { PANEL_PAGES } from '../panels'

// Is this thing a grid, and is it a grid that can be drawn? Two questions with two
// answers, on purpose.
//
// `isPanelGrids` is the cheap structural guard `hydrateConfig` runs on a payload out of
// localStorage: enough to know indices will not run off the end of an array at paint
// time. `gridProblems` is the expensive one, and it is what the shipped grids are held
// to in tests — it checks the properties that make a subdivision *a subdivision*, which
// a hand-edited config can break in ways that only show up as a torn gutter three drags
// later.

/** Tolerance for "these two normalised points are the same", ~1px on a 1200px frame. */
const SAME = 1e-3

const LAYOUT_KINDS = ['landscape', 'portrait', 'square'] as const

function isPoint(v: unknown): v is NormPt {
  return Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n))
}

/**
 * Structural guard: shaped like a grid, with every index in range and every ring
 * closed. A ring may also be *empty* — that is how a grid says "this panel sits on
 * the other page" while staying PANELS-length — but never one or two vertices long,
 * which is a polygon nothing could draw.
 */
export function isPanelGrid(value: unknown, panelCount: number): value is PanelGrid {
  if (!value || typeof value !== 'object') return false
  const grid = value as Partial<PanelGrid>
  if (!Array.isArray(grid.vertices) || !grid.vertices.every(isPoint)) return false
  if (!Array.isArray(grid.panels) || grid.panels.length !== panelCount) return false
  return grid.panels.every(
    ring =>
      Array.isArray(ring) &&
      (ring.length === 0 || ring.length >= 3) &&
      ring.every(i => Number.isInteger(i) && i >= 0 && i < (grid.vertices?.length ?? 0)),
  )
}

/** The same guard for the three-breakpoint record each page carries. */
export function isPanelGrids(value: unknown, panelCount: number): value is PanelGrids {
  if (!value || typeof value !== 'object') return false
  const grids = value as Record<string, unknown>
  return LAYOUT_KINDS.every(kind => isPanelGrid(grids[kind], panelCount))
}

/** And once more for the whole per-page record the config carries. */
export function isPageGrids(value: unknown, panelCount: number): value is PageGrids {
  if (!value || typeof value !== 'object') return false
  const pages = value as Record<string, unknown>
  return PANEL_PAGES.every(page => isPanelGrids(pages[page], panelCount))
}

function onSameFrameEdge(a: NormPt, b: NormPt): boolean {
  return (
    (a[0] <= SAME && b[0] <= SAME) ||
    (a[0] >= 1 - SAME && b[0] >= 1 - SAME) ||
    (a[1] <= SAME && b[1] <= SAME) ||
    (a[1] >= 1 - SAME && b[1] >= 1 - SAME)
  )
}

/** Perpendicular distance from `p` to segment `a→b`, and where along it that lands. */
function distToSegment(p: NormPt, a: NormPt, b: NormPt): { dist: number; t: number } {
  const vx = b[0] - a[0]
  const vy = b[1] - a[1]
  const len2 = vx * vx + vy * vy
  if (len2 === 0) return { dist: Math.hypot(p[0] - a[0], p[1] - a[1]), t: 0 }
  const t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2
  const cx = a[0] + t * vx
  const cy = a[1] + t * vy
  return { dist: Math.hypot(p[0] - cx, p[1] - cy), t }
}

function ringArea(ring: number[], vertices: NormPt[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = vertices[ring[i]]
    const b = vertices[ring[(i + 1) % ring.length]]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

/**
 * Everything wrong with a grid, in plain sentences — empty when it is sound.
 *
 * The two checks worth naming, because they are the ones a hand-edit gets wrong:
 *
 * - **Every edge is shared by exactly two panels, or lies on the outer frame.** An edge
 *   only one panel claims and that is not on the frame is a hole in the page; an edge
 *   three panels claim is an overlap.
 * - **The subdivision conforms.** A vertex that lies part-way along another panel's edge
 *   without being one of that edge's own endpoints is a T-junction the neighbour does
 *   not know about. It draws correctly — right up until that vertex is dragged, when the
 *   neighbour's edge stays straight and the two panels come apart.
 */
export function gridProblems(grid: PanelGrid, panelCount: number): string[] {
  const problems: string[] = []
  if (!isPanelGrid(grid, panelCount)) return [`grid is not structurally a ${panelCount}-panel grid`]

  const { vertices, panels } = grid

  panels.forEach((ring, p) => {
    if (ring.length === 0) return // the panel lives on the other page
    if (new Set(ring).size !== ring.length) problems.push(`panel ${p} names a vertex twice`)
    if (ringArea(ring, vertices) < 1e-6) problems.push(`panel ${p} has no area`)
  })

  const used = new Set(panels.flat())
  vertices.forEach((_, i) => {
    if (!used.has(i)) problems.push(`vertex ${i} belongs to no panel`)
  })

  vertices.forEach((v, i) => {
    vertices.forEach((w, j) => {
      if (j > i && Math.hypot(v[0] - w[0], v[1] - w[1]) < SAME) {
        problems.push(`vertices ${i} and ${j} sit on top of each other`)
      }
    })
  })

  const owners = new Map<string, Set<number>>()
  panels.forEach((ring, p) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const set = owners.get(key) ?? new Set<number>()
      set.add(p)
      owners.set(key, set)
    }
  })
  for (const [key, ps] of owners) {
    const [a, b] = key.split(':').map(Number)
    if (ps.size > 2) problems.push(`edge ${a}-${b} is claimed by ${ps.size} panels`)
    if (ps.size === 1 && !onSameFrameEdge(vertices[a], vertices[b])) {
      problems.push(`edge ${a}-${b} has only one panel and is not on the frame`)
    }
  }

  panels.forEach((ring, p) => {
    for (let i = 0; i < ring.length; i++) {
      const ai = ring[i]
      const bi = ring[(i + 1) % ring.length]
      vertices.forEach((v, vi) => {
        if (vi === ai || vi === bi) return
        const { dist, t } = distToSegment(v, vertices[ai], vertices[bi])
        if (dist < SAME && t > SAME && t < 1 - SAME) {
          problems.push(`vertex ${vi} lies on panel ${p}'s edge ${ai}-${bi} without joining it`)
        }
      })
    }
  })

  return problems
}
