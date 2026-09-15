import { describe, expect, it } from 'vitest'

import { absorbPanel, cutPanelInto, neighboursOf } from '../../skins/comic-book/editor/panelGridAbsorb'
import { cutPanel } from '../../skins/comic-book/editor/panelGridCut'
import { insertBend } from '../../skins/comic-book/editor/panelGridOps'
import { gridProblems } from '../../skins/comic-book/editor/panelGridValidate'
import type { PanelGrid } from '../../skins/comic-book/panelGeometry'

// The geometry of taking a panel off a grid: its ring emptied, its space handed to one
// neighbour, and the seam between them gone. What goes *with* it — the list, the other
// grids, the pictures — is configPanelsRemove.test.ts.

/** Four equal quarters: A top-left, B top-right, C bottom-left, D bottom-right. */
function quarters(): PanelGrid {
  return {
    vertices: [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]],
    panels: [
      [0, 1, 4, 3],
      [1, 2, 5, 4],
      [3, 4, 7, 6],
      [4, 5, 8, 7],
    ],
  }
}

function area(grid: PanelGrid, ring: number[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = grid.vertices[ring[i]]
    const b = grid.vertices[ring[(i + 1) % ring.length]]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

describe('neighboursOf', () => {
  it('lists the panels sharing an edge, longest shared boundary first', () => {
    const grid = quarters()
    // Lower the centre so A shares less with B (0.3 along the top seam) than with C (0.5).
    grid.vertices[4] = [0.5, 0.3]
    expect(neighboursOf(grid, 0)).toEqual([2, 1])
    // D touches A at one corner and shares no edge with it.
    expect(neighboursOf(grid, 0)).not.toContain(3)
  })

  it('is empty for a panel not drawn on this grid', () => {
    const grid = quarters()
    grid.panels[0] = []
    expect(neighboursOf(grid, 0)).toEqual([])
  })
})

describe('absorbPanel', () => {
  it('empties the ring, gives the space to the first neighbour, and stays a valid grid', () => {
    const grid = quarters()
    const out = absorbPanel(grid, 0)
    expect(out).not.toBeNull()
    const { grid: next, into } = out!
    expect(into).toBe(1)
    expect(next.panels).toHaveLength(4)
    expect(next.panels[0]).toEqual([])
    expect(area(next, next.panels[into])).toBeCloseTo(0.5)
    expect(gridProblems(next, 4)).toEqual([])
    // Every other ring is the one it was.
    expect(next.panels[2]).toEqual(grid.panels[2])
    expect(next.panels[3]).toEqual(grid.panels[3])
  })

  it('takes the neighbour it is told to', () => {
    const out = absorbPanel(quarters(), 0, 2)!
    expect(out.into).toBe(2)
    expect(area(out.grid, out.grid.panels[2])).toBeCloseTo(0.5)
    expect(gridProblems(out.grid, 4)).toEqual([])
  })

  it('drops the corners that only the erased seam used, renumbering the rest', () => {
    // Bend the seam between A and B so its middle is a vertex nobody else names.
    const bent = insertBend(quarters(), 1, 4, [0.55, 0.25]).grid
    expect(bent.vertices).toHaveLength(10)
    const out = absorbPanel(bent, 0, 1)!
    expect(out.grid.vertices).toHaveLength(9)
    expect(gridProblems(out.grid, 4)).toEqual([])
    for (const ring of out.grid.panels) {
      for (const v of ring) expect(v).toBeLessThan(out.grid.vertices.length)
    }
  })

  it('undoes a cut: the half cut off a panel folds back into it', () => {
    const cut = cutPanel(quarters(), 0, 'across')!
    const out = absorbPanel(cut.grid, cut.index, 0)!
    expect(out.grid.panels[cut.index]).toEqual([])
    expect(area(out.grid, out.grid.panels[0])).toBeCloseTo(0.25)
    expect(gridProblems(out.grid, cut.grid.panels.length)).toEqual([])
  })

  it('refuses a panel with no neighbour, an empty ring, or a non-neighbour target', () => {
    const whole: PanelGrid = { vertices: [[0, 0], [1, 0], [1, 1], [0, 1]], panels: [[0, 1, 2, 3]] }
    expect(absorbPanel(whole, 0)).toBeNull()

    const gone = quarters()
    gone.panels[0] = []
    expect(absorbPanel(gone, 0)).toBeNull()

    // A and D meet at a corner only.
    expect(absorbPanel(quarters(), 0, 3)).toBeNull()
    expect(absorbPanel(quarters(), 0, 0)).toBeNull()
    expect(absorbPanel(quarters(), 9)).toBeNull()
  })
})

describe('cutPanelInto', () => {
  it('puts the new half into the empty slot rather than on the end of the list', () => {
    const hidden = absorbPanel(quarters(), 0, 1)!.grid
    const out = cutPanelInto(hidden, 1, 'down', 0)
    expect(out).not.toBeNull()
    expect(out!.panels).toHaveLength(4)
    expect(out!.panels[0].length).toBeGreaterThanOrEqual(3)
    expect(area(out!, out!.panels[0])).toBeCloseTo(0.25)
    expect(area(out!, out!.panels[1])).toBeCloseTo(0.25)
    expect(gridProblems(out!, 4)).toEqual([])
  })

  it('refuses a slot that is drawn, the panel itself, or a slot off the list', () => {
    expect(cutPanelInto(quarters(), 1, 'down', 0)).toBeNull()
    const hidden = absorbPanel(quarters(), 0, 1)!.grid
    expect(cutPanelInto(hidden, 0, 'down', 0)).toBeNull()
    expect(cutPanelInto(hidden, 1, 'down', 7)).toBeNull()
  })
})
