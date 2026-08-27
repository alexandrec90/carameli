import type { NormPt, PanelGrid, Rect } from '../panelGeometry'
import { clampVertex, constraintOf, toViewport } from '../panelGeometry'
import { gridProblems } from './panelGridValidate'

// Collapsing two corners into one. Its own module rather than more of panelGridOps.ts
// only because that file is at the 250-line split limit; the contract is the same — pure
// functions of a grid, with the seam-belongs-to-both-panels invariant preserved.
//
// The gesture this backs: drag a corner onto a neighbouring corner and the two become
// one. Without it, dropping a corner on another leaves two coincident vertices joined by
// a zero-length edge — which draws as a smear of gutter and ink around the point, and
// which gridProblems has always called a defect ("sit on top of each other") while the
// editor offered no way to produce anything else.

/** How close, in px, a dragged corner must be to another corner to snap onto it. */
export const VERTEX_SNAP_PX = 12

/**
 * Collapse vertex `from` into vertex `into`: every ring that named `from` names `into`
 * instead, the edge between them — when they were joined — vanishes, and the vertex
 * table drops `from`. Two three-way junctions joined by a sliver of seam become one
 * four-way junction; a bend dropped on a seam end is simply straightened into it.
 *
 * Returns `null` — rather than a torn grid — when the merge is not one the subdivision
 * survives: a ring left with fewer than three corners, a ring that would name the merged
 * vertex twice, or a result `gridProblems` rejects (a hole, an overlap, a T-junction).
 */
export function mergeVertices(
  grid: PanelGrid,
  from: number,
  into: number,
): { grid: PanelGrid; index: number } | null {
  if (from === into || !grid.vertices[from] || !grid.vertices[into]) return null
  const panels: number[][] = []
  for (const ring of grid.panels) {
    const mapped = ring.map(i => (i === from ? into : i))
    // Dropping an entry equal to its successor (cyclically) is what erases the collapsed
    // edge: [.., from, into, ..] maps to [.., into, into, ..] and keeps one.
    const out = mapped.filter((v, i) => v !== mapped[(i + 1) % mapped.length])
    if (ring.length > 0 && out.length < 3) return null
    if (new Set(out).size !== out.length) return null
    panels.push(out)
  }
  const remap = (i: number): number => (i > from ? i - 1 : i)
  const merged: PanelGrid = {
    vertices: grid.vertices.filter((_, i) => i !== from),
    panels: panels.map(ring => ring.map(remap)),
  }
  if (gridProblems(merged, grid.panels.length).length > 0) return null
  return { grid: merged, index: remap(into) }
}

/**
 * The vertex a corner dragged to `at` should snap onto, or `null`: the nearest other
 * vertex within {@link VERTEX_SNAP_PX} in the viewport whose merge would succeed and
 * whose position the dragged vertex may occupy under its own constraint.
 *
 * The constraint check is what keeps a snap from corrupting the drag: a free corner
 * placed *on* the frame would change class mid-gesture and be clamped to the frame ever
 * after, so a target the dragged vertex cannot legally sit on is not offered at all.
 */
export function snapTarget(grid: PanelGrid, index: number, at: NormPt, f: Rect): number | null {
  const current = grid.vertices[index]
  if (!current) return null
  const constraint = constraintOf(current)
  const p = toViewport(at, f)
  let best: number | null = null
  let bestDist = VERTEX_SNAP_PX
  grid.vertices.forEach((v, j) => {
    if (j === index) return
    const q = toViewport(v, f)
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (d > bestDist) return
    const clamped = clampVertex(v, constraint)
    if (clamped[0] !== v[0] || clamped[1] !== v[1]) return
    if (!mergeVertices(grid, index, j)) return
    best = j
    bestDist = d
  })
  return best
}
