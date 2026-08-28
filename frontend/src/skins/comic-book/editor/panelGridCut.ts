import type { NormPt, PanelGrid, VertexConstraint } from '../panelGeometry'
import { insertBend } from './panelGridOps'
import { gridProblems } from './panelGridValidate'

// Making a new panel: cut an existing one in two. The other way to grow a grid — draw a
// closed loop of new lines and hope the rings around it can be re-derived — has no place
// to start from, because every panel is a ring of shared vertex indices and nothing in a
// grid knows which side of a fresh line is inside what. A cut does: the two halves are
// the parent's ring walked from one crossing to the other and back, so every neighbour
// keeps the vertices it already shares and only the parent's ring is rewritten.
//
// The cut is a straight line through the middle of the panel's bounding box, either
// horizontal (`across`, a panel above and one below) or vertical (`down`, one left and
// one right). Where the line meets the outline mid-edge a vertex is inserted — into the
// neighbour across that edge too, exactly as a bend is — and where it meets an existing
// corner that corner is reused. The new seam then behaves like any other: it can be
// dragged, bent, merged and torn, which is why a cut only ever needs to be straight.

/** Which way the cut runs: `across` is a horizontal line, `down` a vertical one. */
export type CutAxis = 'across' | 'down'

/** Tolerance for "on the line" — the validator's own coincidence threshold. */
const ON_LINE = 1e-3

/** A place the cut line meets the ring: an existing corner, or a point on an edge. */
type Crossing = { vertex: number } | { a: number; b: number; point: NormPt }

/**
 * Where `axis`'s cut line at coordinate `c` crosses the ring. A corner sitting on the line
 * counts only when its two neighbours lie on opposite sides — one the line merely grazes
 * belongs to a single half and would leave the other half's ring degenerate. An edge
 * counts when its ends are strictly either side, so an edge lying *along* the line
 * contributes nothing and the corners at its ends decide.
 */
function crossingsOf(grid: PanelGrid, ring: number[], axis: 0 | 1, c: number): Crossing[] | null {
  const n = ring.length
  const side = (i: number): number => {
    const v = grid.vertices[ring[((i % n) + n) % n]]
    if (!v) return Number.NaN
    const d = v[axis] - c
    return Math.abs(d) < ON_LINE ? 0 : Math.sign(d)
  }
  const out: Crossing[] = []
  for (let i = 0; i < n; i++) {
    const here = side(i)
    if (Number.isNaN(here)) return null
    if (here === 0) {
      // Walk past any run of corners on the line to the first neighbour off it.
      let prev = i - 1
      while (side(prev) === 0 && prev > i - n) prev--
      let next = i + 1
      while (side(next) === 0 && next < i + n) next++
      if (side(prev) * side(next) < 0) out.push({ vertex: ring[i] })
      continue
    }
    const there = side(i + 1)
    if (Number.isNaN(there) || here * there >= 0) continue
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const pa = grid.vertices[a]
    const pb = grid.vertices[b]
    if (!pa || !pb) return null
    const t = (c - pa[axis]) / (pb[axis] - pa[axis])
    const point: NormPt = [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])]
    point[axis] = c
    out.push({ a, b, point })
  }
  return out
}

/**
 * The constraint a vertex inserted at `point` on the edge `a`–`b` is under: a frame edge
 * (both ends on the same side of the frame) pins the new vertex to that side, so a cut
 * that meets the outer frame ends *on* it rather than a margin inside, which would leave
 * the halves' outer edges bent by a hair and the frame with a T-junction.
 */
function edgeConstraint(grid: PanelGrid, a: number, b: number): VertexConstraint {
  const pa = grid.vertices[a]
  const pb = grid.vertices[b]
  if (!pa || !pb) return 'free'
  if (pa[0] <= ON_LINE && pb[0] <= ON_LINE) return 'left'
  if (pa[0] >= 1 - ON_LINE && pb[0] >= 1 - ON_LINE) return 'right'
  if (pa[1] <= ON_LINE && pb[1] <= ON_LINE) return 'top'
  if (pa[1] >= 1 - ON_LINE && pb[1] >= 1 - ON_LINE) return 'bottom'
  return 'free'
}

/**
 * Cut `panel` in two along `axis`, at `at` (a normalised coordinate on that axis;
 * default the middle of the panel's bounding box). The parent keeps its index and the
 * upper or left half — so its pictures and balloons stay on the side they were drawn
 * on — and the other half is appended as ring `grid.panels.length`, the index returned.
 *
 * Returns `null`, leaving the grid whole, when the line misses the panel, meets its
 * outline other than exactly twice (a concave panel whose middle the line crosses
 * several times — straighten it first), or would produce a grid the subdivision does
 * not survive (`gridProblems`). Every other ring is untouched apart from gaining the
 * inserted vertex where it shares the cut edge.
 */
export function cutPanel(
  grid: PanelGrid,
  panel: number,
  axis: CutAxis,
  at?: number,
): { grid: PanelGrid; index: number } | null {
  const ring = grid.panels[panel]
  if (!ring || ring.length < 3) return null
  const k: 0 | 1 = axis === 'across' ? 1 : 0
  const coords = ring.map(v => grid.vertices[v]?.[k])
  if (coords.some(v => v === undefined)) return null
  const lo = Math.min(...(coords as number[]))
  const hi = Math.max(...(coords as number[]))
  const c = at ?? (lo + hi) / 2
  if (c <= lo + ON_LINE || c >= hi - ON_LINE) return null

  const crossings = crossingsOf(grid, ring, k, c)
  if (!crossings || crossings.length !== 2) return null

  let working = grid
  const ends: number[] = []
  for (const crossing of crossings) {
    if ('vertex' in crossing) {
      ends.push(crossing.vertex)
      continue
    }
    const { a, b, point } = crossing
    const bent = insertBend(working, a, b, point, edgeConstraint(working, a, b))
    working = bent.grid
    ends.push(bent.index)
  }

  const parent = working.panels[panel] ?? []
  const ip = parent.indexOf(ends[0])
  const iq = parent.indexOf(ends[1])
  if (ip < 0 || iq < 0 || ip === iq) return null
  const walk = (from: number, to: number): number[] => {
    const out: number[] = []
    for (let i = from; ; i = (i + 1) % parent.length) {
      out.push(parent[i])
      if (i === to) break
    }
    return out
  }
  const halfA = walk(ip, iq)
  const halfB = walk(iq, ip)
  const mean = (half: number[]): number =>
    half.reduce((sum, v) => sum + (working.vertices[v]?.[k] ?? 0), 0) / half.length
  // The parent keeps the upper (or left) half: its content was measured against a box
  // whose top-left corner that half still has, so it moves the least.
  const [keep, added] = mean(halfA) <= mean(halfB) ? [halfA, halfB] : [halfB, halfA]

  const panels = working.panels.map((r, i) => (i === panel ? keep : r))
  panels.push(added)
  const next: PanelGrid = { vertices: working.vertices, panels }
  if (gridProblems(next, panels.length).length > 0) return null
  return { grid: next, index: panels.length - 1 }
}
