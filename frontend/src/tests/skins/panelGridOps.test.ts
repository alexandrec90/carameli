import { describe, expect, it } from 'vitest'

import { PANEL_GRIDS } from '../../skins/comic-book/editor/layoutConfig'
import {
  insertBend,
  isRemovableBend,
  moveVertex,
  moveVertices,
  removeVertex,
  seamGeometry,
  seamsOf,
  vertexDegree,
} from '../../skins/comic-book/editor/panelGridOps'
import { gridProblems, isPanelGrid, isPanelGrids } from '../../skins/comic-book/editor/panelGridValidate'
import { EDGE_MARGIN, frameRect, panelRing } from '../../skins/comic-book/panelGeometry'
import type { LayoutKind, PanelGrid } from '../../skins/comic-book/panelGeometry'
import { PANELS } from '../../skins/comic-book/panels'

// The grid edits behind every shape gesture. They are pure functions of a grid, which is
// the point: the drag hook only decides *which* one a gesture means.

const KINDS: LayoutKind[] = ['landscape', 'portrait', 'square']

/**
 * Two panels split by a straight seam from `[0.5, 0]` down to `[0.5, 1]`. Vertices 1 and
 * 2 are the seam's ends and both rings name them, which is the property under test in
 * most of what follows.
 */
function splitGrid(): PanelGrid {
  return {
    vertices: [[0, 0], [0.5, 0], [0.5, 1], [0, 1], [1, 0], [1, 1]],
    panels: [
      [0, 1, 2, 3],
      [1, 4, 5, 2],
    ],
  }
}

describe('the shipped grids', () => {
  it.each(KINDS)('%s has one ring per panel and no structural problems', kind => {
    const grid = PANEL_GRIDS[kind]
    expect(grid.panels).toHaveLength(PANELS.length)
    expect(gridProblems(grid, PANELS.length)).toEqual([])
  })

  it('passes the guard used on a persisted payload', () => {
    expect(isPanelGrids(PANEL_GRIDS, PANELS.length)).toBe(true)
    expect(isPanelGrid(PANEL_GRIDS.landscape, PANELS.length)).toBe(true)
  })

  it.each(KINDS)('%s spans the whole frame — every corner is a locked vertex', kind => {
    const corners = PANEL_GRIDS[kind].vertices.filter(
      ([x, y]) => (x === 0 || x === 1) && (y === 0 || y === 1),
    )
    expect(corners).toHaveLength(4)
  })
})

describe('gridProblems', () => {
  it('catches a ring naming a vertex that is not in the table', () => {
    const grid: PanelGrid = { vertices: [[0, 0], [1, 0], [1, 1]], panels: [[0, 1, 9]] }
    expect(gridProblems(grid, 1)).not.toEqual([])
    expect(isPanelGrid(grid, 1)).toBe(false)
  })

  it('catches a panel count that does not match the skin', () => {
    expect(gridProblems(splitGrid(), 3)).not.toEqual([])
  })

  /*
   * A T-junction is the failure mode that looks like a rendering bug rather than a bad
   * grid: panel A's edge runs straight past a vertex that panel B stops at, so the two
   * agree until the vertex is dragged and then tear apart along that edge. It has to be
   * an *endpoint* for both, which is what "conforming" means here.
   */
  it('catches a vertex sitting on another panel edge without being one of its ends', () => {
    const grid: PanelGrid = {
      vertices: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 1]],
      panels: [
        [0, 1, 2, 3],
        [3, 4, 2],
      ],
    }
    expect(gridProblems(grid, 2)).not.toEqual([])
  })
})

describe('seamsOf', () => {
  it('returns the interior line and nothing else', () => {
    expect(seamsOf(splitGrid())).toEqual([{ a: 1, b: 2, panels: [0, 1] }])
  })

  /*
   * The whole of "the outer frame is always the same": a frame edge belongs to exactly
   * one ring, so it never becomes a seam, so PanelSeams draws no handle on it and there
   * is nothing to drag. It is not a rule the editor enforces after the fact — the gesture
   * does not exist.
   */
  it.each(KINDS)('%s offers no handle on any frame edge', kind => {
    const grid = PANEL_GRIDS[kind]
    for (const seam of seamsOf(grid)) {
      const [ax, ay] = grid.vertices[seam.a]
      const [bx, by] = grid.vertices[seam.b]
      const onSameFrameEdge =
        (ax === 0 && bx === 0) || (ax === 1 && bx === 1) || (ay === 0 && by === 0) || (ay === 1 && by === 1)
      expect(onSameFrameEdge).toBe(false)
      expect(seam.panels[0]).not.toBe(seam.panels[1])
    }
  })

  it('is ordered by vertex index, so a seam id does not wander between renders', () => {
    const seams = seamsOf(PANEL_GRIDS.landscape)
    const keys = seams.map(s => s.a * 1000 + s.b)
    expect([...keys].sort((p, q) => p - q)).toEqual(keys)
  })

  it('places both ends in viewport pixels', () => {
    const [seam] = seamGeometry(splitGrid(), frameRect(1000, 800))
    expect(seam.from).toEqual([500, 8])
    expect(seam.to).toEqual([500, 792])
  })
})

describe('moveVertex', () => {
  /*
   * The reason the grid is a shared-vertex table and not three lists of panel corners:
   * the two panels either side of a seam name the *same index*, so moving it moves both
   * sides at once. Nothing copies the move across, which is why they cannot come apart.
   */
  it('moves both panels that share the vertex', () => {
    const moved = moveVertex(splitGrid(), 1, [0.7, 0])
    const f = frameRect(1000, 800)
    const left = panelRing(moved, 0, f)
    const right = panelRing(moved, 1, f)
    expect(left[1]).toEqual(right[0])
    expect(left[1][0]).toBeCloseTo(f.x + 0.7 * f.w, 6)
  })

  it('holds a frame vertex on its own edge', () => {
    const moved = moveVertex(splitGrid(), 1, [0.7, 0.4])
    expect(moved.vertices[1]).toEqual([0.7, 0])
  })

  it('leaves an out-of-range index alone rather than growing the table', () => {
    const grid = splitGrid()
    const moved = moveVertex(grid, 99, [0.5, 0.5])
    expect(moved.vertices).toEqual(grid.vertices)
  })

  it('returns a new grid, never a mutated one', () => {
    const grid = splitGrid()
    const moved = moveVertex(grid, 1, [0.7, 0])
    expect(grid.vertices[1]).toEqual([0.5, 0])
    expect(moved.vertices).not.toBe(grid.vertices)
  })
})

describe('moveVertices', () => {
  it('slides a whole seam, each end within its own constraint', () => {
    const moved = moveVertices(splitGrid(), [1, 2], 0.1, 0.1)
    // Both ends are on the frame, so the sideways part of the drag lands and the
    // downward part does not: a seam that runs edge to edge stays edge to edge.
    expect(moved.vertices[1]).toEqual([0.6, 0])
    expect(moved.vertices[2]).toEqual([0.6, 1])
  })

  it('moves an interior bend by the full delta', () => {
    const { grid } = insertBend(splitGrid(), 1, 2, [0.5, 0.5])
    const moved = moveVertices(grid, [6], -0.2, 0.1)
    expect(moved.vertices[6][0]).toBeCloseTo(0.3, 6)
    expect(moved.vertices[6][1]).toBeCloseTo(0.6, 6)
  })
})

describe('insertBend', () => {
  it('splices the new corner into both rings that share the segment', () => {
    const { grid, index } = insertBend(splitGrid(), 1, 2, [0.35, 0.5])
    expect(index).toBe(6)
    expect(grid.vertices[index]).toEqual([0.35, 0.5])
    // Between 1 and 2 in the left ring, and between 2 and 1 in the right one, which walks
    // the same edge the other way.
    expect(grid.panels[0]).toEqual([0, 1, 6, 2, 3])
    expect(grid.panels[1]).toEqual([1, 4, 5, 2, 6])
    expect(gridProblems(grid, 2)).toEqual([])
  })

  it('makes a lightning bolt when repeated on the pieces of a broken seam', () => {
    const once = insertBend(splitGrid(), 1, 2, [0.35, 0.35])
    const twice = insertBend(once.grid, once.index, 2, [0.65, 0.7])
    expect(twice.grid.vertices).toHaveLength(8)
    expect(twice.grid.panels[0]).toEqual([0, 1, 6, 7, 2, 3])
    expect(seamsOf(twice.grid)).toHaveLength(3)
    expect(gridProblems(twice.grid, 2)).toEqual([])
  })

  it('keeps a bend clear of the frame, so it stays a bend', () => {
    const { grid, index } = insertBend(splitGrid(), 1, 2, [0, 0])
    expect(grid.vertices[index]).toEqual([EDGE_MARGIN, EDGE_MARGIN])
    expect(isRemovableBend(grid, index)).toBe(true)
  })
})

describe('removeVertex', () => {
  it('straightens a bend out and renumbers what came after it', () => {
    const { grid, index } = insertBend(splitGrid(), 1, 2, [0.35, 0.5])
    const back = removeVertex(grid, index)
    expect(back).toEqual(splitGrid())
  })

  it('renumbers the rings when the removed vertex was not the last one', () => {
    const { grid } = insertBend(splitGrid(), 1, 2, [0.35, 0.5])
    // Move the bend to index 0 by rebuilding the table around it, as a hand-edited
    // config or a future op could: the remap has to follow, or every ring shifts.
    const shuffled: PanelGrid = {
      vertices: [grid.vertices[6], ...grid.vertices.slice(0, 6)],
      panels: grid.panels.map(ring => ring.map(i => (i === 6 ? 0 : i + 1))),
    }
    const back = removeVertex(shuffled, 0)
    expect(back).not.toBeNull()
    expect(back?.vertices).toEqual(splitGrid().vertices)
    expect(back?.panels).toEqual(splitGrid().panels)
  })

  it('refuses a frame vertex — the outer frame is not the author’s to bite into', () => {
    expect(removeVertex(splitGrid(), 1)).toBeNull()
    expect(isRemovableBend(splitGrid(), 1)).toBe(false)
  })

  it('refuses a junction where three seams meet', () => {
    // A T of three panels: vertex 4 is where all three rings meet.
    const tee: PanelGrid = {
      vertices: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0.5, 0], [0.5, 1]],
      panels: [
        [0, 5, 4, 6, 3],
        [5, 1, 4],
        [4, 1, 2, 6],
      ],
    }
    expect(vertexDegree(tee, 4)).toBeGreaterThan(2)
    expect(isRemovableBend(tee, 4)).toBe(false)
    expect(removeVertex(tee, 4)).toBeNull()
  })

  it('refuses a bend whose removal would leave a two-sided panel', () => {
    const triangle: PanelGrid = {
      vertices: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]],
      panels: [
        [0, 1, 4],
        [1, 2, 3, 0, 4],
      ],
    }
    expect(isRemovableBend(triangle, 4)).toBe(false)
    expect(removeVertex(triangle, 4)).toBeNull()
  })
})
