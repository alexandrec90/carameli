import { useCallback, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import type { Rect } from '../panelGeometry'
import { QUAD_RANGE, quadViewport } from '../tableProjection'
import type { Quad } from '../tableProjection'
import type { ImgTransform, TableProjection } from './types'
import type { EditorModeApi } from './useEditorMode'

// Dragging the four corners of a projected surface. The gesture is the whole tilt
// control: there is no rotate slider and no perspective field, because a plane already
// drawn in a photograph is matched by putting four points on four points, not by
// searching three angles that each undo the last.

/** Put one corner of a quad somewhere, clamped to the range a corner may be dragged to. */
export function setCorner(quad: Quad, corner: number, x: number, y: number): Quad {
  const clamp = (n: number) =>
    Number.isFinite(n) ? Math.min(Math.max(n, QUAD_RANGE.min), QUAD_RANGE.max) : 0
  return quad.map((p, i) => (i === corner ? [clamp(x), clamp(y)] : [p[0], p[1]])) as Quad
}

export interface TableCornerDragApi {
  /** The four corners in viewport px, in quad order: TL, TR, BR, BL. */
  corners: [number, number][]
  onCornerDown(e: ReactPointerEvent, corner: number): void
  onPointerMove(e: ReactPointerEvent): void
  onPointerUp(e: ReactPointerEvent): void
}

/**
 * Corner-dragging over one picture's surface.
 *
 * `rect` is the picture's frame in viewport px — the same box `imgRect` gives the
 * selection outline — and it is what makes the maths two lines: the overlay layer is
 * `position: fixed; inset: 0`, so a pointer's client coordinates are already viewport
 * coordinates and a corner is just their offset into the frame, as a percentage.
 *
 * The grab offset is captured on pointer-down rather than a running delta, so a pointer
 * that leaves the window and comes back puts the corner where it was picked up instead of
 * jumping it under the cursor.
 */
export function useTableCornerDrag(
  api: EditorModeApi,
  index: number,
  table: TableProjection,
  rect: Rect,
): TableCornerDragApi {
  const drag = useRef<{ corner: number; offset: [number, number] } | null>(null)

  const corners = useMemo(() => quadViewport(rect, table.quad), [rect, table.quad])

  /** A pointer position as a percentage of the frame box. */
  const pct = useCallback(
    (e: { clientX: number; clientY: number }): [number, number] => [
      rect.w > 0 ? ((e.clientX - rect.x) / rect.w) * 100 : 0,
      rect.h > 0 ? ((e.clientY - rect.y) / rect.h) * 100 : 0,
    ],
    [rect],
  )

  const write = useCallback(
    (quad: Quad) => {
      const patch: Partial<ImgTransform> = { table: { ...table, quad } }
      api.setImg(index, patch)
    },
    [api, index, table],
  )

  const onCornerDown = useCallback(
    (e: ReactPointerEvent, corner: number) => {
      e.preventDefault()
      e.stopPropagation()
      const at = table.quad[corner]
      if (!at) return
      const [px, py] = pct(e)
      drag.current = { corner, offset: [at[0] - px, at[1] - py] }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [pct, table.quad],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const state = drag.current
      if (!state) return
      e.preventDefault()
      const [px, py] = pct(e)
      write(setCorner(table.quad, state.corner, px + state.offset[0], py + state.offset[1]))
    },
    [pct, table.quad, write],
  )

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    if (!drag.current) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  return { corners, onCornerDown, onPointerMove, onPointerUp }
}
