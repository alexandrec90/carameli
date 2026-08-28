import { describe, expect, it } from 'vitest'

import { PANEL_GRIDS, PANELS } from '../../skins/comic-book/editor/layoutConfig'
import { cutPanel } from '../../skins/comic-book/editor/panelGridCut'
import { gridProblems } from '../../skins/comic-book/editor/panelGridValidate'
import { constraintOf } from '../../skins/comic-book/panelGeometry'
import type { LayoutKind, PanelGrid } from '../../skins/comic-book/panelGeometry'
import { PANEL_PAGES } from '../../skins/comic-book/panels'

// The geometry of making a panel: one ring cut in two along a straight line, with the
// crossings inserted into whichever neighbour shares the cut edge. What goes *with* the
// cut — the panel list, the patterns, the other grids — is configPanels.test.ts.

const KINDS: LayoutKind[] = ['landscape', 'portrait', 'square']

/** Two panels side by side, the seam running from `[0.5, 0]` down to `[0.5, 1]`. */
function splitGrid(): PanelGrid {
  return {
    vertices: [[0, 0], [0.5, 0], [0.5, 1], [0, 1], [1, 0], [1, 1]],
    panels: [
      [0, 1, 2, 3],
      [1, 4, 5, 2],
    ],
  }
}

/** The y (axis 1) or x (axis 0) of every vertex a ring names. */
function coords(grid: PanelGrid, ring: number[], axis: 0 | 1): number[] {
  return ring.map(v => grid.vertices[v][axis])
}

describe('cutPanel across', () => {
  it('cuts the left panel into a top and a bottom half, the parent keeping the top', () => {
    const grid = splitGrid()
    const cut = cutPanel(grid, 0, 'across')
    expect(cut).not.toBeNull()
    const { grid: out, index } = cut!
    expect(index).toBe(2)
    expect(out.panels).toHaveLength(3)
    expect(Math.max(...coords(out, out.panels[0], 1))).toBeCloseTo(0.5)
    expect(Math.min(...coords(out, out.panels[2], 1))).toBeCloseTo(0.5)
    expect(gridProblems(out, 3)).toEqual([])
  })

  it('inserts the crossing into the neighbour that shares the cut edge', () => {
    const out = cutPanel(splitGrid(), 0, 'across')!.grid
    // The right panel gained the seam's new mid-vertex and nothing else.
    expect(out.panels[1]).toHaveLength(5)
    expect(out.vertices).toHaveLength(8)
    const shared = out.panels[1].filter(v => out.panels[0].includes(v) || out.panels[2].includes(v))
    expect(shared).toHaveLength(3)
  })

  it('pins a crossing on the outer frame to that frame edge', () => {
    const out = cutPanel(splitGrid(), 0, 'across')!.grid
    const constraints = out.vertices.slice(6).map(constraintOf).sort()
    expect(constraints).toEqual(['free', 'left'])
    const onFrame = out.vertices.slice(6).find(v => constraintOf(v) === 'left')!
    expect(onFrame).toEqual([0, 0.5])
  })

  it('cuts where it is told to', () => {
    const out = cutPanel(splitGrid(), 0, 'across', 0.25)!.grid
    expect(out.vertices.slice(6).map(v => v[1])).toEqual([0.25, 0.25])
    expect(Math.max(...coords(out, out.panels[0], 1))).toBeCloseTo(0.25)
  })

  it('leaves the input grid alone', () => {
    const grid = splitGrid()
    const before = JSON.stringify(grid)
    cutPanel(grid, 0, 'across')
    expect(JSON.stringify(grid)).toBe(before)
  })
})

describe('cutPanel down', () => {
  it('cuts the right panel into a left and a right half, the parent keeping the left', () => {
    const cut = cutPanel(splitGrid(), 1, 'down')
    expect(cut).not.toBeNull()
    const { grid: out, index } = cut!
    expect(index).toBe(2)
    expect(Math.max(...coords(out, out.panels[1], 0))).toBeCloseTo(0.75)
    expect(Math.min(...coords(out, out.panels[2], 0))).toBeCloseTo(0.75)
    // The left panel shares no edge with the cut, so it is untouched.
    expect(out.panels[0]).toEqual([0, 1, 2, 3])
    expect(out.vertices.slice(6).map(constraintOf).sort()).toEqual(['bottom', 'top'])
    expect(gridProblems(out, 3)).toEqual([])
  })
})

describe('cutPanel reusing a corner', () => {
  it('reuses a corner already sitting on the line instead of inserting one', () => {
    // The seam has a bend at [0.5, 0.5], so the line meets it at an existing vertex.
    const grid: PanelGrid = {
      vertices: [[0, 0], [0.5, 0], [0.5, 0.5], [0.5, 1], [0, 1], [1, 0], [1, 1]],
      panels: [
        [0, 1, 2, 3, 4],
        [1, 5, 6, 3, 2],
      ],
    }
    const cut = cutPanel(grid, 0, 'across')
    expect(cut).not.toBeNull()
    const out = cut!.grid
    expect(out.vertices).toHaveLength(8)
    expect(out.panels[1]).toEqual([1, 5, 6, 3, 2])
    expect(out.panels[0]).toContain(2)
    expect(out.panels[2]).toContain(2)
    expect(gridProblems(out, 3)).toEqual([])
  })
})

describe('cutPanel refusals', () => {
  it('refuses a panel that is not there, or has no area', () => {
    expect(cutPanel(splitGrid(), 5, 'across')).toBeNull()
    const grid = splitGrid()
    grid.panels[0] = [0, 1]
    expect(cutPanel(grid, 0, 'across')).toBeNull()
  })

  it('refuses a line that misses the panel', () => {
    expect(cutPanel(splitGrid(), 0, 'across', 1.2)).toBeNull()
    expect(cutPanel(splitGrid(), 0, 'across', 0)).toBeNull()
    expect(cutPanel(splitGrid(), 1, 'down', 0.5)).toBeNull()
  })

  it('refuses a concave panel the line would cross more than twice', () => {
    // A U around a second panel in its notch: the line through the U's middle enters
    // and leaves each arm.
    const grid: PanelGrid = {
      vertices: [[0, 0], [1, 0], [1, 1], [0.7, 1], [0.7, 0.3], [0.3, 0.3], [0.3, 1], [0, 1]],
      panels: [
        [0, 1, 2, 3, 4, 5, 6, 7],
        [5, 4, 3, 6],
      ],
    }
    expect(cutPanel(grid, 0, 'across')).toBeNull()
    // Cut the other way, the same U divides cleanly through its base, and the panel in
    // the notch gains the crossing on the edge it shares.
    const down = cutPanel(grid, 0, 'down')
    expect(down).not.toBeNull()
    expect(down!.index).toBe(2)
    expect(down!.grid.panels[1]).toHaveLength(5)
    expect(gridProblems(down!.grid, 3)).toEqual([])
  })
})

describe('cutPanel on the shipped grids', () => {
  const PAGE_KINDS = PANEL_PAGES.flatMap(page => KINDS.map(kind => [page, kind] as const))

  it('cuts every shipped panel both ways, in every grid of its page, and stays valid', () => {
    for (const [page, kind] of PAGE_KINDS) {
      const grid = PANEL_GRIDS[page][kind]
      grid.panels.forEach((ring, i) => {
        if (ring.length === 0) {
          expect(cutPanel(grid, i, 'across'), `${page}/${kind} panel ${i}`).toBeNull()
          return
        }
        for (const axis of ['across', 'down'] as const) {
          const cut = cutPanel(grid, i, axis)
          expect(cut, `${page}/${kind} panel ${i} ${axis}`).not.toBeNull()
          expect(cut!.index).toBe(PANELS.length)
          expect(gridProblems(cut!.grid, PANELS.length + 1)).toEqual([])
        }
      })
    }
  })
})
