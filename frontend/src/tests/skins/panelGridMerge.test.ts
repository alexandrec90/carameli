import { describe, expect, it } from 'vitest'

import { mergeVertices, snapTarget, VERTEX_SNAP_PX } from '../../skins/comic-book/editor/panelGridMerge'
import { insertBend } from '../../skins/comic-book/editor/panelGridOps'
import { gridProblems } from '../../skins/comic-book/editor/panelGridValidate'
import { frameRect } from '../../skins/comic-book/panelGeometry'
import type { NormPt, PanelGrid } from '../../skins/comic-book/panelGeometry'

// Collapsing two corners into one — the edit that used to be impossible, which is how a
// grid ended up with two vertices 0.0009 apart joined by a zero-length seam that drew as
// a smear of gutter around the point.

/** Two panels split by a straight seam from `[0.5, 0]` down to `[0.5, 1]`. */
function splitGrid(): PanelGrid {
  return {
    vertices: [[0, 0], [0.5, 0], [0.5, 1], [0, 1], [1, 0], [1, 1]],
    panels: [
      [0, 1, 2, 3],
      [1, 4, 5, 2],
    ],
  }
}

/**
 * The shape the merge exists for: four panels whose middle is **two** three-way
 * junctions (8 and 9) joined by a sliver of seam — exactly what dropping one corner near
 * another used to leave behind. Merging them makes one four-way junction.
 */
function doubleCenter(): PanelGrid {
  return {
    vertices: [
      [0, 0], [1, 0], [1, 1], [0, 1],
      [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5],
      [0.45, 0.5], [0.55, 0.5],
    ],
    panels: [
      [0, 4, 8, 6], // top-left
      [4, 1, 7, 9, 8], // top-right
      [9, 7, 2, 5], // bottom-right
      [6, 8, 9, 5, 3], // bottom-left
    ],
  }
}

/** A pinwheel: four side panels around an interior square, all four corners free. */
function pinwheel(): PanelGrid {
  return {
    vertices: [
      [0, 0], [1, 0], [1, 1], [0, 1],
      [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5],
      [0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6],
    ],
    panels: [
      [0, 4, 8, 7],
      [4, 1, 5, 9, 8],
      [7, 8, 11, 6, 3],
      [6, 11, 10, 9, 5, 2],
      [8, 9, 10, 11],
    ],
  }
}

describe('mergeVertices', () => {
  it('collapses two junctions joined by a sliver seam into one four-way junction', () => {
    const merged = mergeVertices(doubleCenter(), 9, 8)
    expect(merged).not.toBeNull()
    expect(merged?.index).toBe(8)
    expect(merged?.grid.vertices).toHaveLength(9)
    expect(merged?.grid.vertices[8]).toEqual([0.45, 0.5])
    expect(merged?.grid.panels).toEqual([
      [0, 4, 8, 6],
      [4, 1, 7, 8],
      [8, 7, 2, 5],
      [6, 8, 5, 3],
    ])
    expect(gridProblems(merged!.grid, 4)).toEqual([])
  })

  it('keeps the stationary corner’s position and renumbers when it came after the dragged one', () => {
    const merged = mergeVertices(doubleCenter(), 8, 9)
    expect(merged?.index).toBe(8)
    expect(merged?.grid.vertices[8]).toEqual([0.55, 0.5])
    expect(gridProblems(merged!.grid, 4)).toEqual([])
  })

  it('merges two interior corners of a pinwheel into a clean junction', () => {
    const merged = mergeVertices(pinwheel(), 8, 9)
    expect(merged).not.toBeNull()
    expect(gridProblems(merged!.grid, 5)).toEqual([])
  })

  it('straightens a bend dropped onto the end of its own seam', () => {
    const { grid, index } = insertBend(splitGrid(), 1, 2, [0.45, 0.5])
    const merged = mergeVertices(grid, index, 1)
    expect(merged?.grid).toEqual(splitGrid())
    expect(merged?.index).toBe(1)
  })

  it('merges two corners sliding along the same frame edge', () => {
    const three: PanelGrid = {
      vertices: [[0, 0], [0.33, 0], [0.33, 1], [0, 1], [0.66, 0], [0.66, 1], [1, 0], [1, 1]],
      panels: [
        [0, 1, 2, 3],
        [1, 4, 5, 2],
        [4, 6, 7, 5],
      ],
    }
    const merged = mergeVertices(three, 1, 4)
    expect(merged?.grid.panels[1]).toEqual([4, 5, 2].map(i => (i > 1 ? i - 1 : i)))
    expect(gridProblems(merged!.grid, 3)).toEqual([])
  })

  it('refuses a merge that would leave a two-sided panel', () => {
    const triangle: PanelGrid = {
      vertices: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]],
      panels: [
        [0, 1, 4],
        [1, 2, 3, 0, 4],
      ],
    }
    expect(mergeVertices(triangle, 4, 0)).toBeNull()
  })

  it('refuses a merge that would make a ring name one corner twice', () => {
    // Opposite corners of the pinwheel's interior square: the square's ring would become
    // [10, 9, 10, 11], which is not a polygon.
    expect(mergeVertices(pinwheel(), 8, 10)).toBeNull()
  })

  it('refuses identity and out-of-range indices, and never mutates its input', () => {
    const grid = doubleCenter()
    expect(mergeVertices(grid, 8, 8)).toBeNull()
    expect(mergeVertices(grid, 99, 8)).toBeNull()
    expect(mergeVertices(grid, 8, 99)).toBeNull()
    mergeVertices(grid, 9, 8)
    expect(grid).toEqual(doubleCenter())
  })
})

describe('snapTarget', () => {
  const f = frameRect(1000, 800)
  /** A point a few px in viewport terms away from `v`, along x. */
  const nearX = ([x, y]: NormPt, px: number): NormPt => [x + px / f.w, y]

  it('offers the corner under the pointer when the merge would survive', () => {
    const grid = doubleCenter()
    expect(snapTarget(grid, 9, nearX(grid.vertices[8], 5), f)).toBe(8)
  })

  it('offers nothing outside the snap radius', () => {
    const grid = doubleCenter()
    expect(snapTarget(grid, 9, nearX(grid.vertices[8], VERTEX_SNAP_PX + 5), f)).toBeNull()
  })

  it('offers nothing when the merge would tear the grid, however close the corner is', () => {
    const grid = pinwheel()
    expect(mergeVertices(grid, 8, 10)).toBeNull()
    expect(snapTarget(grid, 8, nearX(grid.vertices[10], 3), f)).toBeNull()
  })

  it('never offers a frame corner to a free vertex — the snap would change its constraint', () => {
    const { grid, index } = insertBend(splitGrid(), 1, 2, [0.5, 0.1])
    // Vertex 1 sits on the top frame edge; the bend is interior and may not occupy it.
    expect(snapTarget(grid, index, nearX(grid.vertices[1], 2), f)).toBeNull()
  })

  it('lets a frame-edge vertex snap along its own edge', () => {
    const three: PanelGrid = {
      vertices: [[0, 0], [0.33, 0], [0.33, 1], [0, 1], [0.66, 0], [0.66, 1], [1, 0], [1, 1]],
      panels: [
        [0, 1, 2, 3],
        [1, 4, 5, 2],
        [4, 6, 7, 5],
      ],
    }
    expect(snapTarget(three, 1, nearX(three.vertices[4], -4), f)).toBe(4)
  })
})
