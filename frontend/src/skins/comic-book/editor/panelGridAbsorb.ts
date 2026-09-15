import type { NormPt, PanelGrid } from '../panelGeometry'
import type { CutAxis } from './panelGridCut'
import { cutPanel } from './panelGridCut'
import { gridProblems } from './panelGridValidate'

// Taking a panel *off* one grid. The inverse of panelGridCut.ts: a cut draws a seam
// through a ring and makes two, this erases the seam between a ring and one of its
// neighbours and makes one. Nothing else can vanish a panel from a grid, because a grid
// has no holes — every interior edge is shared by exactly two rings (`gridProblems`) —
// so the space a panel leaves has to be somebody's, and its neighbour across the longest
// shared boundary is the one whose outline changes least.
//
// The panel's slot is kept and its ring emptied, which is how a grid already says "not on
// this window shape" — the same empty ring a panel holds on the page it is not on. So a
// panel hidden here is still a panel, still indexed by every picture on it, and can be
// brought back by `cutPanelInto` cutting a neighbour and handing the half to that slot.

/** Undirected edge key, so the two rings' opposite traversals of a seam compare equal. */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function edgeKeysOf(ring: number[]): Set<string> {
  const keys = new Set<string>()
  for (let i = 0; i < ring.length; i++) keys.add(edgeKey(ring[i], ring[(i + 1) % ring.length]))
  return keys
}

/**
 * Where a ring's edges marked `shared` form one unbroken cyclic run: its first edge and
 * its length, or null when the marks are absent, cover the whole ring, or fall in two
 * or more stretches (two rings touching in two separate places enclose a third between
 * them, and their union would have a hole).
 */
function singleRun(shared: boolean[]): { start: number; count: number } | null {
  const n = shared.length
  const count = shared.filter(Boolean).length
  if (count === 0 || count === n) return null
  const starts = shared.flatMap((s, i) => (s && !shared[(i - 1 + n) % n] ? [i] : []))
  return starts.length === 1 ? { start: starts[0], count } : null
}

/** Length in normalised units of the ring edges also owned by `other`. */
function sharedLength(grid: PanelGrid, ring: number[], other: number[]): number {
  const theirs = edgeKeysOf(other)
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (!theirs.has(edgeKey(a, b))) continue
    const pa = grid.vertices[a]
    const pb = grid.vertices[b]
    if (pa && pb) total += Math.hypot(pb[0] - pa[0], pb[1] - pa[1])
  }
  return total
}

/**
 * The panels sharing at least one edge with `panel`, longest shared boundary first —
 * the order `absorbPanel` tries them in.
 */
export function neighboursOf(grid: PanelGrid, panel: number): number[] {
  const ring = grid.panels[panel]
  if (!ring || ring.length < 3) return []
  return grid.panels
    .map((other, i) => ({ i, shared: i === panel ? 0 : sharedLength(grid, ring, other) }))
    .filter(({ shared }) => shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .map(({ i }) => i)
}

/**
 * One ring that covers both, with the boundary they share erased: `into`'s ring walked
 * as it is, except that the interior of the shared run is replaced by the rest of
 * `panel`'s outline. Both rings are clockwise, so they traverse the shared run in
 * opposite directions and the splice reads straight off the two index tables. Null when
 * the run is not one unbroken stretch in both.
 */
function unionRings(panel: number[], into: number[]): number[] | null {
  const ofPanel = edgeKeysOf(panel)
  const ofInto = edgeKeysOf(into)
  const runIn = singleRun(into.map((v, i) => ofPanel.has(edgeKey(v, into[(i + 1) % into.length]))))
  const runOf = singleRun(panel.map((v, i) => ofInto.has(edgeKey(v, panel[(i + 1) % panel.length]))))
  if (!runIn || !runOf || runIn.count !== runOf.count) return null
  // Rotate so each ring's shared run starts at index 0 and ends at index `count`.
  const n = into.map((_, i) => into[(runIn.start + i) % into.length])
  const p = panel.map((_, i) => panel[(runOf.start + i) % panel.length])
  const k = runIn.count
  // Opposite traversals: the run enters `into` where it leaves `panel`, and vice versa.
  if (n[0] !== p[k] || n[k] !== p[0]) return null
  // `panel`'s outline off the run, from n[0] (= p[k]) round to n[k] (= p[0]), exclusive.
  const outer = p.slice(k + 1)
  return [n[0], ...outer, ...n.slice(k)]
}

/** Drop every vertex no ring names, renumbering the rings that remain. */
function dropUnused(vertices: NormPt[], panels: number[][]): PanelGrid {
  const used = new Set(panels.flat())
  const remap = new Map<number, number>()
  const kept: NormPt[] = []
  vertices.forEach((v, i) => {
    if (!used.has(i)) return
    remap.set(i, kept.length)
    kept.push(v)
  })
  return { vertices: kept, panels: panels.map(ring => ring.map(i => remap.get(i) ?? i)) }
}

/**
 * Give `panel`'s area to a neighbour, leaving `panel` an empty ring — hidden on this
 * grid, its slot kept. `into` names the neighbour; left out, the neighbours are tried
 * longest shared boundary first and the first the subdivision survives is taken.
 *
 * Returns the new grid and which panel absorbed the space, or null — the grid untouched —
 * when the panel is not drawn here, has no neighbour (it is the whole page), or every
 * candidate union is one `gridProblems` rejects.
 */
export function absorbPanel(
  grid: PanelGrid,
  panel: number,
  into?: number,
): { grid: PanelGrid; into: number } | null {
  const ring = grid.panels[panel]
  if (!ring || ring.length < 3) return null
  const candidates = into === undefined ? neighboursOf(grid, panel) : [into]
  for (const target of candidates) {
    const other = grid.panels[target]
    if (target === panel || !other || other.length < 3) continue
    const merged = unionRings(ring, other)
    if (!merged) continue
    const panels = grid.panels.map((r, i) => (i === panel ? [] : i === target ? merged : r))
    const next = dropUnused(grid.vertices, panels)
    if (gridProblems(next, panels.length).length > 0) continue
    return { grid: next, into: target }
  }
  return null
}

/**
 * {@link cutPanel}, with the new half going into the empty slot `slot` instead of onto
 * the end of the list — the way a panel hidden on this grid is shown again, cut out of
 * whichever neighbour the author picks. Null when the slot is not empty, is the panel
 * being cut, or the cut itself is refused.
 */
export function cutPanelInto(
  grid: PanelGrid,
  panel: number,
  axis: CutAxis,
  slot: number,
): PanelGrid | null {
  const target = grid.panels[slot]
  if (slot === panel || !target || target.length !== 0) return null
  const cut = cutPanel(grid, panel, axis)
  if (!cut) return null
  const added = cut.grid.panels[cut.index]
  const panels = cut.grid.panels.slice(0, cut.index).map((r, i) => (i === slot ? added : r))
  const next: PanelGrid = { vertices: cut.grid.vertices, panels }
  return gridProblems(next, panels.length).length > 0 ? null : next
}
