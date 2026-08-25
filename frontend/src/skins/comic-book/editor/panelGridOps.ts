import type { NormPt, PanelGrid, Rect, VpPt } from '../panelGeometry'
import { clampVertex, constraintOf, toViewport } from '../panelGeometry'

// Every edit the shape editor makes to a {@link PanelGrid}, as pure functions. They live
// apart from the React state for the same reason `configOps.ts` does — a seam is shared
// by two panels, so inserting a bend or deleting one is real bookkeeping across rings
// rather than a field assignment, and it is worth testing without a DOM.
//
// The one invariant every operation here preserves: **a seam belongs to both its
// panels**. An insert that reached only one ring, or a delete that left the other's copy
// behind, produces two panels whose shared boundary has stopped being shared — which
// looks identical until the new vertex is dragged and the gutter tears open.

/** An interior boundary segment: the two panels that share it, and its two ends. */
export interface Seam {
  /** Lower vertex index of the pair — seams are keyed unordered. */
  a: number
  /** Higher vertex index of the pair. */
  b: number
  /** The two panels this segment separates. */
  panels: [number, number]
}

/** A seam positioned for a viewport: its ends in pixels, for hit-testing and handles. */
export interface SeamGeometry extends Seam {
  from: VpPt
  to: VpPt
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`)

/** Walk every ring edge as an ordered `[from, to]` index pair. */
function forEachEdge(grid: PanelGrid, fn: (a: number, b: number, panel: number) => void): void {
  grid.panels.forEach((ring, panel) => {
    for (let i = 0; i < ring.length; i++) {
      fn(ring[i], ring[(i + 1) % ring.length], panel)
    }
  })
}

/**
 * Every interior segment of the grid — the lines the author is allowed to move.
 *
 * An edge shared by two rings is a seam; one that appears in a single ring lies on the
 * outer frame, which is fixed and so is deliberately absent from this list. That is the
 * whole of "the outer frame is not editable": there is no handle for it to be dragged by.
 */
export function seamsOf(grid: PanelGrid): Seam[] {
  const owners = new Map<string, number[]>()
  forEachEdge(grid, (a, b, panel) => {
    const key = edgeKey(a, b)
    const list = owners.get(key)
    if (list) {
      if (!list.includes(panel)) list.push(panel)
    } else {
      owners.set(key, [panel])
    }
  })
  const seams: Seam[] = []
  for (const [key, panels] of owners) {
    if (panels.length !== 2) continue
    const [a, b] = key.split(':').map(Number)
    seams.push({ a, b, panels: [panels[0], panels[1]] })
  }
  // Sorted so a seam's index is a function of the grid alone — the editor uses it as a
  // selection id, and an id that depended on Map iteration order would wander.
  return seams.sort((p, q) => p.a - q.a || p.b - q.b)
}

/** The same seams, placed in a viewport frame. */
export function seamGeometry(grid: PanelGrid, f: Rect): SeamGeometry[] {
  return seamsOf(grid).map(s => ({
    ...s,
    from: toViewport(grid.vertices[s.a] ?? [0, 0], f),
    to: toViewport(grid.vertices[s.b] ?? [0, 0], f),
  }))
}

/** How many distinct vertices a vertex is joined to by any ring edge. */
export function vertexDegree(grid: PanelGrid, index: number): number {
  const neighbours = new Set<number>()
  forEachEdge(grid, (a, b) => {
    if (a === index) neighbours.add(b)
    if (b === index) neighbours.add(a)
  })
  return neighbours.size
}

/**
 * True when a vertex is a plain **bend** — a point added to smooth or kink one seam —
 * rather than a junction where three or more seams meet, or a frame vertex.
 *
 * Only a bend can be deleted. Removing a junction would merge the panels around it, and
 * removing a frame vertex would take a bite out of the outer frame; neither is an edit
 * this editor offers, so both are refused rather than half-performed.
 */
export function isRemovableBend(grid: PanelGrid, index: number): boolean {
  const v = grid.vertices[index]
  if (!v || constraintOf(v) !== 'free') return false
  if (vertexDegree(grid, index) !== 2) return false
  return grid.panels.every(ring => !ring.includes(index) || ring.length > 3)
}

/** Move one vertex to a new normalised position, clamped to what its constraint allows. */
export function moveVertex(grid: PanelGrid, index: number, target: NormPt): PanelGrid {
  const current = grid.vertices[index]
  if (!current) return grid
  const next = clampVertex(target, constraintOf(current))
  return {
    vertices: grid.vertices.map((v, i) => (i === index ? next : v)),
    panels: grid.panels,
  }
}

/**
 * Move several vertices at once by the same normalised delta, each clamped by its own
 * constraint — which is how dragging a whole seam works.
 *
 * A seam with one end pinned to the frame therefore pivots rather than slides: the free
 * end follows the pointer and the pinned end takes only the component that runs along
 * its frame edge. That is the honest outcome of "the outer frame never moves", and
 * spelling it as a pivot beats refusing the drag.
 */
export function moveVertices(grid: PanelGrid, indices: number[], dx: number, dy: number): PanelGrid {
  const moving = new Set(indices)
  return {
    vertices: grid.vertices.map((v, i) => {
      if (!moving.has(i)) return v
      return clampVertex([v[0] + dx, v[1] + dy], constraintOf(v))
    }),
    panels: grid.panels,
  }
}

/**
 * Break a seam at `at`, giving it a corner: the new vertex is appended to the vertex
 * table and spliced into **both** panels that share the segment.
 *
 * Repeat it and the seam becomes a lightning bolt — which is the whole feature, and why
 * a bend is a vertex like any other rather than a second kind of thing. It is dragged,
 * nudged and deleted by the same operations as a junction.
 */
export function insertBend(
  grid: PanelGrid,
  a: number,
  b: number,
  at: NormPt,
): { grid: PanelGrid; index: number } {
  const index = grid.vertices.length
  const vertices: NormPt[] = [...grid.vertices, clampVertex(at, 'free')]
  const panels = grid.panels.map(ring => {
    const out: number[] = []
    for (let i = 0; i < ring.length; i++) {
      const from = ring[i]
      const to = ring[(i + 1) % ring.length]
      out.push(from)
      if ((from === a && to === b) || (from === b && to === a)) out.push(index)
    }
    return out
  })
  return { grid: { vertices, panels }, index }
}

/**
 * Delete a bend, straightening the seam back out. Returns `null` — rather than a grid
 * with something quietly not done — when the vertex is not a removable bend, so a caller
 * that ignores the result cannot leave the author looking at an unchanged page and
 * believing the delete worked.
 */
export function removeVertex(grid: PanelGrid, index: number): PanelGrid | null {
  if (!isRemovableBend(grid, index)) return null
  const remap = (i: number): number => (i > index ? i - 1 : i)
  return {
    vertices: grid.vertices.filter((_, i) => i !== index),
    panels: grid.panels.map(ring => ring.filter(v => v !== index).map(remap)),
  }
}
