import { describe, expect, it } from 'vitest'

import {
  applyHomography,
  DEFAULT_QUAD,
  quadMatrix3d,
  quadPx,
  quadSourceBox,
  quadViewport,
  surfaceStyle,
  unitHomography,
} from '../../skins/comic-book/tableProjection'
import type { Quad } from '../../skins/comic-book/tableProjection'
import { setCorner } from '../../skins/comic-book/editor/useTableCornerDrag'
import type { TableProjection } from '../../skins/comic-book/editor/types'

// The geometry that lands a flat table on a surface drawn in a photograph. The claim
// every test here is checking is the same one: the four corners the author dragged are
// exactly where the table's four corners end up. Anything less is a table that *nearly*
// sits on the ruled lines, which is the one failure the whole feature is about.

const FRAME = { w: 400, h: 300 }

/** A quad with real perspective in it — the far edge shorter than the near one. */
const TILTED: Quad = [
  [20, 30],
  [80, 25],
  [95, 90],
  [5, 85],
]

/**
 * Push a point through a `matrix3d(...)` string the way CSS does.
 *
 * CSS matrices are column-major, so the coefficients that multiply x are v[0], v[1],
 * v[3] and the ones that multiply y are v[4], v[5], v[7]; v[12], v[13], v[15] are the
 * translation and the homogeneous constant. Written out rather than reusing the module's
 * own maths, so a sign error in the emitter cannot cancel itself out in the test.
 */
function applyMatrix3d(css: string, x: number, y: number): [number, number] {
  const v = css.slice('matrix3d('.length, -1).split(',').map(Number)
  const w = v[3] * x + v[7] * y + v[15]
  return [(v[0] * x + v[4] * y + v[12]) / w, (v[1] * x + v[5] * y + v[13]) / w]
}

describe('quadPx / quadViewport', () => {
  it('reads the quad as percentages of the frame box', () => {
    expect(quadPx(DEFAULT_QUAD, 400, 300)).toEqual([
      [40, 30],
      [360, 30],
      [360, 270],
      [40, 270],
    ])
  })

  it('offsets by the frame origin for the editor grips', () => {
    const pts = quadViewport({ x: 100, y: 50, w: 400, h: 300 }, DEFAULT_QUAD)
    expect(pts[0]).toEqual([140, 80])
    expect(pts[2]).toEqual([460, 320])
  })
})

describe('quadSourceBox', () => {
  it('averages the two horizontal edges and the two vertical ones', () => {
    expect(quadSourceBox(DEFAULT_QUAD, 400, 300)).toEqual({ w: 320, h: 240 })
  })

  // The point of laying out at the average edge rather than at the frame: a 3D-transformed
  // element is rasterised once at its layout size, so a table laid out much larger than
  // the quad it lands in is downsampled lettering.
  it('shrinks with the quad, so the transform scale stays near 1', () => {
    const small: Quad = [
      [40, 40],
      [60, 40],
      [60, 60],
      [40, 60],
    ]
    const box = quadSourceBox(small, 400, 300)
    expect(box.w).toBeCloseTo(80)
    expect(box.h).toBeCloseTo(60)
  })

  it('gives a zero box for a quad collapsed to a point', () => {
    const point: Quad = [
      [50, 50],
      [50, 50],
      [50, 50],
      [50, 50],
    ]
    expect(quadSourceBox(point, 400, 300)).toEqual({ w: 0, h: 0 })
  })
})

describe('unitHomography', () => {
  it('maps the unit square onto the four corners exactly', () => {
    const pts = quadPx(TILTED, FRAME.w, FRAME.h)
    const m = unitHomography(pts)
    expect(m).not.toBeNull()
    const corners: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    corners.forEach(([u, v], i) => {
      const [x, y] = applyHomography(m as number[], u, v)
      expect(x).toBeCloseTo(pts[i][0], 6)
      expect(y).toBeCloseTo(pts[i][1], 6)
    })
  })

  // A NaN matrix is dropped silently by CSS: the surface would simply not appear, with
  // nothing in the console to say why. Refusing here is what lets the caller draw nothing
  // on purpose instead.
  it('refuses a degenerate quad rather than returning NaNs', () => {
    expect(unitHomography([[0, 0], [10, 10], [20, 20], [30, 30]])).toBeNull()
    expect(unitHomography([[5, 5], [5, 5], [5, 5], [5, 5]])).toBeNull()
  })
})

describe('quadMatrix3d', () => {
  it('lands the laid-out box exactly on the quad', () => {
    const src = quadSourceBox(TILTED, FRAME.w, FRAME.h)
    const css = quadMatrix3d(TILTED, FRAME, src)
    const target = quadPx(TILTED, FRAME.w, FRAME.h)
    const box: [number, number][] = [
      [0, 0],
      [src.w, 0],
      [src.w, src.h],
      [0, src.h],
    ]
    box.forEach(([x, y], i) => {
      const [px, py] = applyMatrix3d(css, x, y)
      expect(px).toBeCloseTo(target[i][0], 3)
      expect(py).toBeCloseTo(target[i][1], 3)
    })
  })

  it('emits sixteen coefficients with the z row left as the identity', () => {
    const src = quadSourceBox(TILTED, FRAME.w, FRAME.h)
    const v = quadMatrix3d(TILTED, FRAME, src).slice('matrix3d('.length, -1).split(',').map(Number)
    expect(v).toHaveLength(16)
    expect([v[2], v[6], v[8], v[9], v[11], v[14]]).toEqual([0, 0, 0, 0, 0, 0])
    expect([v[10], v[15]]).toEqual([1, 1])
  })

  // A quad with real perspective converges: the far edge of the surface is drawn shorter
  // than the near one, which is what matches ruled lines receding in a photograph. A
  // purely affine transform cannot do it, and shows up here as a zero fourth row.
  it('carries the perspective divide for a quad that is not a parallelogram', () => {
    const src = quadSourceBox(TILTED, FRAME.w, FRAME.h)
    const v = quadMatrix3d(TILTED, FRAME, src).slice('matrix3d('.length, -1).split(',').map(Number)
    expect(Math.abs(v[3]) + Math.abs(v[7])).toBeGreaterThan(0)
  })

  it('is none for a degenerate quad or an empty layout box', () => {
    const line: Quad = [
      [0, 0],
      [10, 10],
      [20, 20],
      [30, 30],
    ]
    expect(quadMatrix3d(line, FRAME, { w: 100, h: 100 })).toBe('none')
    expect(quadMatrix3d(DEFAULT_QUAD, FRAME, { w: 0, h: 100 })).toBe('none')
  })
})

describe('setCorner', () => {
  it('moves one corner and leaves the other three where they were', () => {
    const moved = setCorner(DEFAULT_QUAD, 1, 72.5, 18)
    expect(moved[1]).toEqual([72.5, 18])
    expect(moved[0]).toEqual(DEFAULT_QUAD[0])
    expect(moved).not.toBe(DEFAULT_QUAD)
  })

  // A surface can legitimately overhang its picture — a notepad photographed at the edge
  // of the frame has corners off it — so the range is wider than the frame but still
  // bounded, because a corner dragged to infinity cannot be dragged back.
  it('clamps a corner dragged far outside the picture', () => {
    const moved = setCorner(DEFAULT_QUAD, 2, 5000, -5000)
    expect(moved[2]).toEqual([200, -100])
  })

  it('reads an unparseable coordinate as zero rather than as NaN', () => {
    expect(setCorner(DEFAULT_QUAD, 0, Number.NaN, 40)[0]).toEqual([0, 40])
  })
})

describe('surfaceStyle', () => {
  const table = (quad: Quad): TableProjection => ({
    quad,
    rows: 8,
    header: true,
    columns: [{ label: 'a', width: 1, align: 'left' }],
    data: [],
    fontScale: 0.5,
    ink: '#1b3a8f',
  })

  it('lays the table out at the source box and transforms it onto the quad', () => {
    const style = surfaceStyle(table(DEFAULT_QUAD), { x: 0, y: 0, ...FRAME })
    expect(style).toMatchObject({ left: 0, top: 0, width: 320, height: 240 })
    expect(style.transform.startsWith('matrix3d(')).toBe(true)
  })

  // The base rect is the picture's rendered rect, which rarely sits at the wrapper's
  // origin: the offset is carried by left/top while the homography stays solved in the
  // rect's own space. Under the old frame-based measure both were implicitly zero, so
  // reverting to it fails here.
  it('places the surface at the base rect and keeps the transform rect-local', () => {
    const at = surfaceStyle(table(DEFAULT_QUAD), { x: 150, y: 40, ...FRAME })
    const origin = surfaceStyle(table(DEFAULT_QUAD), { x: 0, y: 0, ...FRAME })
    expect(at).toMatchObject({ left: 150, top: 40, width: 320, height: 240 })
    expect(at.transform).toBe(origin.transform)
  })

  it('reports none for a surface that cannot be drawn', () => {
    const point: Quad = [
      [50, 50],
      [50, 50],
      [50, 50],
      [50, 50],
    ]
    expect(surfaceStyle(table(point), { x: 0, y: 0, ...FRAME }).transform).toBe('none')
  })
})
