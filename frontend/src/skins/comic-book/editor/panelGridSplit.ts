import type { NormPt, PanelGrid, Rect, VpPt } from '../panelGeometry'
import { clampVertex, constraintOf, toNormalized, toViewport } from '../panelGeometry'
import { gridProblems } from './panelGridValidate'

// The inverse of panelGridMerge.ts: pull one junction apart into two. Together the two
// modules make the merge reversible — a cross collapsed out of two three-way junctions
// can be torn back into them — and any junction can be opened into shapes a merge alone
// cannot produce.
//
// The gesture this backs: Alt-drag a corner. The seams on the drag side of the corner
// follow the pointer, the rest stay put, and the two corners are left joined by a new
// edge. Which panels share that edge falls out of the ring bookkeeping below, not out
// of any geometry test.

/** How close, in px, a dragged corner must be to a seam's continuation line to snap onto it. */
export const ALIGN_SNAP_PX = 6

const sub = (a: NormPt, b: NormPt): NormPt => [a[0] - b[0], a[1] - b[1]]

/** Every vertex `index` is joined to by any ring edge. */
function neighboursOf(grid: PanelGrid, index: number): number[] {
  const out = new Set<number>()
  for (const ring of grid.panels) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (a === index) out.add(b)
      if (b === index) out.add(a)
    }
  }
  return [...out]
}

/**
 * Tear vertex `index` in two: the neighbours on the `along` side of it are re-joined to
 * a new vertex placed at `to`, the rest keep the old one, and any ring that kept one
 * neighbour on each side gains both vertices — the new edge between them. `along`
 * defaults to `to` and exists so a snap can adjust where the torn corner lands without
 * re-deciding which seams it took.
 *
 * Returns `null` — leaving the grid whole — when the tear means nothing (no drag
 * direction, or every seam on one side of it) or when the torn grid is not one the
 * subdivision survives (`gridProblems`: the corners still coincide, an overlap, a
 * T-junction). The stationary vertex keeps its index, so nothing else renumbers.
 */
export function splitVertex(
  grid: PanelGrid,
  index: number,
  to: NormPt,
  along: NormPt = to,
): { grid: PanelGrid; index: number } | null {
  const v = grid.vertices[index]
  if (!v) return null
  const dir = sub(along, v)
  if (Math.hypot(dir[0], dir[1]) === 0) return null
  const neighbours = neighboursOf(grid, index)
  const moving = new Set<number>()
  for (const n of neighbours) {
    const d = sub(grid.vertices[n] ?? v, v)
    if (d[0] * dir[0] + d[1] * dir[1] > 0) moving.add(n)
  }
  if (moving.size === 0 || moving.size === neighbours.length) return null
  const torn = grid.vertices.length
  const panels = grid.panels.map(ring => {
    const i = ring.indexOf(index)
    if (i < 0) return ring
    const prev = moving.has(ring[(i - 1 + ring.length) % ring.length])
    const next = moving.has(ring[(i + 1) % ring.length])
    if (prev && next) return ring.map(j => (j === index ? torn : j))
    if (!prev && !next) return ring
    // A ring split across the tear walks through both corners; the torn one goes
    // beside the neighbour it kept, so the new edge sits between the two sides.
    const pair = prev ? [torn, index] : [index, torn]
    return [...ring.slice(0, i), ...pair, ...ring.slice(i + 1)]
  })
  const split: PanelGrid = {
    vertices: [...grid.vertices, clampVertex(to, constraintOf(v))],
    panels,
  }
  if (gridProblems(split, grid.panels.length).length > 0) return null
  return { grid: split, index: torn }
}

/**
 * The position that puts a corner dragged to `at` exactly on the continuation of a
 * neighbouring seam, or `null`: the nearest line through a neighbour and *its* further
 * neighbour, within {@link ALIGN_SNAP_PX} in the viewport, extended past the shared
 * corner. Only the extension counts — on the segment's own body the snapped corner
 * would sit part-way along an existing edge, which is the T-junction the validator
 * forbids — and a line the corner's own frame constraint cannot reach is not offered.
 */
export function snapAligned(grid: PanelGrid, index: number, at: NormPt, f: Rect): NormPt | null {
  const current = grid.vertices[index]
  if (!current) return null
  const constraint = constraintOf(current)
  const p = toViewport(at, f)
  let best: NormPt | null = null
  let bestDist = ALIGN_SNAP_PX
  for (const u of neighboursOf(grid, index)) {
    const qu = toViewport(grid.vertices[u] ?? current, f)
    for (const w of neighboursOf(grid, u)) {
      if (w === index) continue
      const qw = toViewport(grid.vertices[w] ?? current, f)
      const dx = qu[0] - qw[0]
      const dy = qu[1] - qw[1]
      const len = Math.hypot(dx, dy)
      if (len === 0) continue
      const beyond = ((p[0] - qu[0]) * dx + (p[1] - qu[1]) * dy) / len
      if (beyond <= 1) continue
      const q: VpPt = [qu[0] + (dx / len) * beyond, qu[1] + (dy / len) * beyond]
      const dist = Math.hypot(p[0] - q[0], p[1] - q[1])
      if (dist >= bestDist) continue
      const snapped = toNormalized(q, f)
      const clamped = clampVertex(snapped, constraint)
      if (clamped[0] !== snapped[0] || clamped[1] !== snapped[1]) continue
      best = snapped
      bestDist = dist
    }
  }
  return best
}

/**
 * One frame of an Alt-drag: the tear at `to`, with the torn corner snapped onto a
 * neighbouring seam's line when one is close enough — which is how a torn cross folds
 * exactly flat onto the seam it came out of. Classification always follows the raw
 * pointer (`to`), so the snap adjusts where the torn corner lands, never which seams
 * came along with it.
 */
export function tearDrag(
  grid: PanelGrid,
  index: number,
  to: NormPt,
  f: Rect,
): { grid: PanelGrid; index: number } | null {
  const split = splitVertex(grid, index, to)
  if (!split) return null
  const aligned = snapAligned(split.grid, split.index, to, f)
  if (aligned) return splitVertex(grid, index, aligned, to) ?? split
  return split
}
