import { describe, expect, it } from 'vitest'

import { mergeVertices } from '../../skins/comic-book/editor/panelGridMerge'
import { insertBend } from '../../skins/comic-book/editor/panelGridOps'
import { ALIGN_SNAP_PX, snapAligned, splitVertex, tearDrag } from '../../skins/comic-book/editor/panelGridSplit'
import { gridProblems } from '../../skins/comic-book/editor/panelGridValidate'
import { frameRect } from '../../skins/comic-book/panelGeometry'
import type { PanelGrid } from '../../skins/comic-book/panelGeometry'

/** Two panels split by a vertical seam at x = 0.5. */
function splitGrid(): PanelGrid {
  return {
    vertices: [
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    panels: [
      [0, 1, 2, 3],
      [1, 4, 5, 2],
    ],
  }
}

/** Four panels meeting at one four-way junction — what merging two junctions leaves. */
function cross(): PanelGrid {
  return {
    vertices: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0],
      [0.5, 1],
      [0, 0.5],
      [1, 0.5],
      [0.5, 0.5],
    ],
    panels: [
      [0, 4, 8, 6],
      [4, 1, 7, 8],
      [8, 7, 2, 5],
      [6, 8, 5, 3],
    ],
  }
}

/** Three columns, so the top frame edge carries two junctions to merge and re-tear. */
function three(): PanelGrid {
  return {
    vertices: [
      [0, 0],
      [0.33, 0],
      [0.33, 1],
      [0, 1],
      [0.66, 0],
      [0.66, 1],
      [1, 0],
      [1, 1],
    ],
    panels: [
      [0, 1, 2, 3],
      [1, 4, 5, 2],
      [4, 6, 7, 5],
    ],
  }
}

describe('splitVertex', () => {
  it('tears a four-way junction into two three-way junctions', () => {
    const split = splitVertex(cross(), 8, [0.4, 0.45])
    expect(split).not.toBeNull()
    expect(split?.index).toBe(9)
    expect(split?.grid.vertices[9]).toEqual([0.4, 0.45])
    expect(split?.grid.vertices[8]).toEqual([0.5, 0.5])
    expect(split?.grid.panels).toEqual([
      [0, 4, 9, 6],
      [4, 1, 7, 8, 9],
      [8, 7, 2, 5],
      [6, 9, 8, 5, 3],
    ])
    expect(gridProblems(split?.grid as PanelGrid, 4)).toEqual([])
  })

  it('is the inverse of a merge: tearing and merging back restores the cross', () => {
    const split = splitVertex(cross(), 8, [0.4, 0.45])
    expect(split).not.toBeNull()
    const back = mergeVertices(split?.grid as PanelGrid, split?.index as number, 8)
    expect(back?.grid).toEqual(cross())
  })

  it('classifies by the drag direction, so the other diagonal tears the other seams off', () => {
    const split = splitVertex(cross(), 8, [0.4, 0.55])
    expect(split?.grid.panels).toEqual([
      [0, 4, 8, 9, 6],
      [4, 1, 7, 8],
      [9, 8, 7, 2, 5],
      [6, 9, 5, 3],
    ])
    expect(gridProblems(split?.grid as PanelGrid, 4)).toEqual([])
  })

  it('refuses a tear that goes nowhere, and one with every seam on one side', () => {
    expect(splitVertex(cross(), 8, [0.5, 0.5])).toBeNull()
    // A bend dragged square across its own seam moves both neighbours to neither side.
    const bent = insertBend(splitGrid(), 1, 2, [0.5, 0.5])
    expect(splitVertex(bent.grid, bent.index, [0.6, 0.5])).toBeNull()
  })

  it('tears a bend into two corners along its own seam', () => {
    const bent = insertBend(splitGrid(), 1, 2, [0.5, 0.5])
    const split = splitVertex(bent.grid, bent.index, [0.52, 0.58])
    expect(split).not.toBeNull()
    expect(split?.grid.vertices).toHaveLength(bent.grid.vertices.length + 1)
    expect(gridProblems(split?.grid as PanelGrid, 2)).toEqual([])
  })

  it('refuses a tear too small for the two corners to come apart', () => {
    expect(splitVertex(cross(), 8, [0.5004, 0.5])).toBeNull()
  })

  it('tears a frame junction apart along its own frame edge', () => {
    const merged = mergeVertices(three(), 1, 4)
    expect(merged).not.toBeNull()
    const split = splitVertex(merged?.grid as PanelGrid, merged?.index as number, [0.45, 0.02])
    expect(split).not.toBeNull()
    // The torn corner inherits the junction's frame constraint, so it stays on the edge.
    expect(split?.grid.vertices[split?.index as number]).toEqual([0.45, 0])
    expect(gridProblems(split?.grid as PanelGrid, 3)).toEqual([])
  })

  it('never mutates its input', () => {
    const grid = cross()
    splitVertex(grid, 8, [0.4, 0.45])
    expect(grid).toEqual(cross())
  })
})

describe('snapAligned', () => {
  const f = frameRect(1000, 800)

  it('snaps a corner onto the continuation of a neighbouring seam', () => {
    const split = splitVertex(cross(), 8, [0.4, 0.45])
    const at = snapAligned(split?.grid as PanelGrid, 9, [0.4, 0.5 - 3 / f.h], f)
    expect(at).not.toBeNull()
    expect(at?.[0]).toBeCloseTo(0.4, 6)
    expect(at?.[1]).toBeCloseTo(0.5, 6)
  })

  it('offers nothing outside the snap radius', () => {
    const split = splitVertex(cross(), 8, [0.4, 0.45])
    const off = (ALIGN_SNAP_PX + 4) / f.h
    expect(snapAligned(split?.grid as PanelGrid, 9, [0.4, 0.5 - off], f)).toBeNull()
  })

  it('never snaps onto the body of a seam — only past its end', () => {
    const split = splitVertex(cross(), 8, [0.4, 0.45])
    // x = 0.7 projects between the junction and the right frame, T-junction territory.
    expect(snapAligned(split?.grid as PanelGrid, 9, [0.7, 0.5 - 3 / f.h], f)).toBeNull()
  })
})

describe('tearDrag', () => {
  const f = frameRect(1000, 800)

  it('folds the torn corner exactly onto the seam line when close enough', () => {
    const torn = tearDrag(cross(), 8, [0.4, 0.5 - 3 / f.h], f)
    expect(torn).not.toBeNull()
    expect(torn?.grid.vertices[9]?.[0]).toBeCloseTo(0.4, 6)
    expect(torn?.grid.vertices[9]?.[1]).toBeCloseTo(0.5, 6)
    expect(gridProblems(torn?.grid as PanelGrid, 4)).toEqual([])
  })

  it('the snap adjusts where the torn corner lands, never which seams it took', () => {
    // The raw pointer is above the horizontal, so the top seam tears off; snapped flat
    // onto the line, that direction would classify differently — and must not.
    const torn = tearDrag(cross(), 8, [0.4, 0.5 - 3 / f.h], f)
    expect(torn?.grid.panels).toEqual([
      [0, 4, 9, 6],
      [4, 1, 7, 8, 9],
      [8, 7, 2, 5],
      [6, 9, 8, 5, 3],
    ])
  })

  it('keeps the plain tear when no line is near', () => {
    const torn = tearDrag(cross(), 8, [0.4, 0.42], f)
    expect(torn).toEqual(splitVertex(cross(), 8, [0.4, 0.42]))
  })

  it('returns null when nothing tears', () => {
    expect(tearDrag(cross(), 8, [0.5, 0.5], f)).toBeNull()
  })
})
