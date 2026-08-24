import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'

import { logger } from '../../../lib/logger'
import type { LayoutKind, NormPt, PanelGrid, Rect, VpPt } from '../panelGeometry'
import { toNormalized } from '../panelGeometry'
import type { SeamGeometry } from './panelGridOps'
import { insertBend, isRemovableBend, moveVertex, moveVertices, removeVertex, seamGeometry } from './panelGridOps'
import type { EditorModeApi } from './useEditorMode'

// The pointer and keyboard half of the shape editor. Every actual grid edit is a pure
// function from ./panelGridOps.ts; this hook decides which one a gesture means and hands
// the result to the editor state.
//
// Nothing here writes a vertex directly. A vertex is shared by the panels that meet at
// it, so "drag the line between 1 and 2" is only ever "move that vertex" — the second
// panel follows because it names the same index, not because anything copies the move
// across. That is why the two cannot come apart, and why the drag code is this short.

/** How far, in px, a pointer may be from a seam and still be dragging it. */
export const SEAM_HIT_PX = 10

/** Arrow-key nudge in px, and the multiplier Shift applies. */
const NUDGE_PX = 1
const NUDGE_FAST = 10

type DragState =
  | { kind: 'vertex'; index: number; offset: NormPt }
  | { kind: 'seam'; indices: number[]; last: NormPt }

export interface SeamDragApi {
  /** Every interior segment of the current grid, placed for this viewport. */
  seams: SeamGeometry[]
  /** The vertex currently selected, or null. */
  selectedVertex: number | null
  /** False when the selected vertex is a junction or on the frame, so Delete is refused. */
  canDeleteSelected: boolean
  onVertexDown(e: ReactPointerEvent, index: number): void
  onSeamDown(e: ReactPointerEvent, seam: SeamGeometry): void
  onSeamDoubleClick(e: ReactMouseEvent, seam: SeamGeometry): void
  onPointerMove(e: ReactPointerEvent): void
  onPointerUp(e: ReactPointerEvent): void
  /** Straighten the selected bend back out; a no-op with a warning when it is not one. */
  deleteSelected(): void
}

/**
 * Shape-editing gestures over one grid: drag a corner, drag a whole line, double-click a
 * line to break it, arrow-nudge, Delete to straighten.
 *
 * `frame` is the page frame in viewport px, which is what makes the pointer maths a
 * two-line affair: the overlay layer is `position: fixed; inset: 0`, so a pointer's
 * client coordinates are already viewport coordinates and only need normalising.
 */
export function useSeamDrag(
  api: EditorModeApi,
  kind: LayoutKind,
  grid: PanelGrid,
  frame: Rect,
): SeamDragApi {
  const drag = useRef<DragState | null>(null)
  const seams = useMemo(() => seamGeometry(grid, frame), [grid, frame])

  const selectedVertex =
    api.selected?.kind === 'vertex' && api.selected.index < grid.vertices.length
      ? api.selected.index
      : null

  const norm = useCallback(
    (e: { clientX: number; clientY: number }): NormPt =>
      toNormalized([e.clientX, e.clientY] as VpPt, frame),
    [frame],
  )

  const onVertexDown = useCallback(
    (e: ReactPointerEvent, index: number) => {
      e.preventDefault()
      e.stopPropagation()
      const v = grid.vertices[index]
      if (!v) return
      const p = norm(e)
      // Grab offset rather than a running delta: a pointer that leaves and re-enters the
      // window then still puts the corner where it was picked up, not where it drifted to.
      drag.current = { kind: 'vertex', index, offset: [v[0] - p[0], v[1] - p[1]] }
      e.currentTarget.setPointerCapture(e.pointerId)
      api.select('vertex', index)
    },
    [api, grid, norm],
  )

  const onSeamDown = useCallback(
    (e: ReactPointerEvent, seam: SeamGeometry) => {
      e.preventDefault()
      e.stopPropagation()
      drag.current = { kind: 'seam', indices: [seam.a, seam.b], last: norm(e) }
      e.currentTarget.setPointerCapture(e.pointerId)
      api.select('seam', seams.findIndex(s => s.a === seam.a && s.b === seam.b))
    },
    [api, norm, seams],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const state = drag.current
      if (!state) return
      e.preventDefault()
      const p = norm(e)
      if (state.kind === 'vertex') {
        api.setGridFor(kind, moveVertex(grid, state.index, [p[0] + state.offset[0], p[1] + state.offset[1]]))
        return
      }
      api.setGridFor(kind, moveVertices(grid, state.indices, p[0] - state.last[0], p[1] - state.last[1]))
      state.last = p
    },
    [api, grid, kind, norm],
  )

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    if (!drag.current) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const onSeamDoubleClick = useCallback(
    (e: ReactMouseEvent, seam: SeamGeometry) => {
      e.preventDefault()
      e.stopPropagation()
      // The bend goes where the pointer is, not at the midpoint: a lightning bolt is a
      // sequence of corners the author placed, and starting each one in the middle would
      // make every seam bend the same way before it bent the way they meant.
      const { grid: next, index } = insertBend(grid, seam.a, seam.b, norm(e))
      api.setGridFor(kind, next)
      api.select('vertex', index)
    },
    [api, grid, kind, norm],
  )

  const canDeleteSelected = selectedVertex !== null && isRemovableBend(grid, selectedVertex)

  const deleteSelected = useCallback(() => {
    if (selectedVertex === null) return
    const next = removeVertex(grid, selectedVertex)
    if (!next) {
      // Refused rather than half-done: removing a junction would merge the panels around
      // it and removing a frame vertex would bite into the outer frame.
      logger.warn('Comic-book editor: vertex is not a removable bend', { vertex: selectedVertex })
      return
    }
    api.setGridFor(kind, next)
    api.clear()
  }, [api, grid, kind, selectedVertex])

  // Arrow keys nudge the selected corner a pixel at a time (ten with Shift), which is the
  // only way to place one exactly — a pointer cannot reliably hit a tenth of a percent.
  useEffect(() => {
    if (api.mode !== 'shapes' || selectedVertex === null) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
        return
      }
      const step = (e.shiftKey ? NUDGE_FAST : NUDGE_PX)
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      if (dx === 0 && dy === 0) return
      e.preventDefault()
      const v = grid.vertices[selectedVertex]
      if (!v) return
      api.setGridFor(
        kind,
        moveVertex(grid, selectedVertex, [
          v[0] + (frame.w > 0 ? dx / frame.w : 0),
          v[1] + (frame.h > 0 ? dy / frame.h : 0),
        ]),
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api, deleteSelected, frame.h, frame.w, grid, kind, selectedVertex])

  return {
    seams,
    selectedVertex,
    canDeleteSelected,
    onVertexDown,
    onSeamDown,
    onSeamDoubleClick,
    onPointerMove,
    onPointerUp,
    deleteSelected,
  }
}
