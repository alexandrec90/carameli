import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'

import type { PanelPoly } from '../Layout'
import {
  BUBBLE_W,
  IMG_SCALE,
  dragBubble,
  dragImg,
  resizeBubble,
  rotateBubble,
  scaleBubble,
  scaleImg,
} from './transforms'
import type { BubbleTransform, ImgTransform } from './types'
import type { EditorModeApi } from './useEditorMode'

/** What a pointer drag is doing to the selected target. */
export type DragMode = 'move' | 'resize' | 'rotate'

/** px-delta → scale-delta factor for the image corner resize handle. */
const IMG_HANDLE_SCALE = 0.005
/** px-delta → degree factor for the bubble rotate handle. */
const BUBBLE_ROTATE_DEG = 0.5
/** Wheel `deltaY` → scale-delta factor for image zoom. */
const WHEEL_SCALE = 0.001
/** Wheel `deltaY` → bubble width-% factor (one 100px notch = 2% of the panel box). */
const WHEEL_BUBBLE_W = 0.02

interface DragState {
  id: number
  startX: number
  startY: number
  mode: DragMode
  startImg?: ImgTransform
  startBubble?: BubbleTransform
}

export interface OverlayInteraction {
  beginDrag(e: ReactPointerEvent, mode: DragMode): void
  onPointerMove(e: ReactPointerEvent): void
  onPointerUp(e: ReactPointerEvent): void
  onWheel(e: ReactWheelEvent): void
}

/**
 * Wires pointer + keyboard input for the dev editor overlay to the pure transform
 * helpers and `useEditorMode` mutators. The handler bodies stay thin: they read the
 * drag's *starting* transform, hand a px delta to a pure helper, and commit the
 * result — so they are correct regardless of React batching during a fast drag.
 */
export function useOverlayInteraction(
  api: EditorModeApi,
  panelPolys: PanelPoly[],
): OverlayInteraction {
  const drag = useRef<DragState | null>(null)

  const beginDrag = (e: ReactPointerEvent, mode: DragMode) => {
    const sel = api.selected
    if (!sel) return
    // Stop a handle's pointerdown from also starting a body "move" drag.
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      mode,
      startImg: sel.kind === 'img' ? api.config.images[sel.index] : undefined,
      startBubble: sel.kind === 'bubble' ? api.config.bubbles[sel.index] : undefined,
    }
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    const sel = api.selected
    if (!d || d.id !== e.pointerId || !sel) return
    const bounds = panelPolys[sel.index]?.bounds
    if (!bounds) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY

    if (sel.kind === 'img' && d.startImg) {
      const next =
        d.mode === 'move'
          ? dragImg(d.startImg, dx, dy)
          : scaleImg(d.startImg, (dx + dy) * IMG_HANDLE_SCALE)
      api.setImg(sel.index, next)
    } else if (sel.kind === 'bubble' && d.startBubble) {
      const next =
        d.mode === 'move'
          ? dragBubble(d.startBubble, dx, dy, bounds.w, bounds.h)
          : d.mode === 'resize'
            ? resizeBubble(d.startBubble, dx, bounds.w)
            : rotateBubble(d.startBubble, dx * BUBBLE_ROTATE_DEG)
      api.setBubble(sel.index, next)
    }
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    if (drag.current?.id !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    drag.current = null
  }

  const onWheel = (e: ReactWheelEvent) => {
    const sel = api.selected
    if (!sel) return
    if (sel.kind === 'img') {
      api.setImg(sel.index, scaleImg(api.config.images[sel.index], -e.deltaY * WHEEL_SCALE))
    } else {
      api.setBubble(sel.index, scaleBubble(api.config.bubbles[sel.index], -e.deltaY * WHEEL_BUBBLE_W))
    }
  }

  // Keyboard: arrows nudge (Shift = 10px), +/- zoom/resize, Esc deselects.
  useEffect(() => {
    const sel = api.selected
    if (!sel) return

    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 1
      let handled = true

      if (sel.kind === 'img') {
        const cur = api.config.images[sel.index]
        switch (e.key) {
          case 'ArrowLeft': api.setImg(sel.index, dragImg(cur, -step, 0)); break
          case 'ArrowRight': api.setImg(sel.index, dragImg(cur, step, 0)); break
          case 'ArrowUp': api.setImg(sel.index, dragImg(cur, 0, -step)); break
          case 'ArrowDown': api.setImg(sel.index, dragImg(cur, 0, step)); break
          case '+': case '=': api.setImg(sel.index, scaleImg(cur, IMG_SCALE.step)); break
          case '-': case '_': api.setImg(sel.index, scaleImg(cur, -IMG_SCALE.step)); break
          case 'Escape': api.clear(); break
          default: handled = false
        }
      } else {
        const cur = api.config.bubbles[sel.index]
        const bounds = panelPolys[sel.index]?.bounds
        if (!bounds) return
        switch (e.key) {
          case 'ArrowLeft': api.setBubble(sel.index, dragBubble(cur, -step, 0, bounds.w, bounds.h)); break
          case 'ArrowRight': api.setBubble(sel.index, dragBubble(cur, step, 0, bounds.w, bounds.h)); break
          case 'ArrowUp': api.setBubble(sel.index, dragBubble(cur, 0, -step, bounds.w, bounds.h)); break
          case 'ArrowDown': api.setBubble(sel.index, dragBubble(cur, 0, step, bounds.w, bounds.h)); break
          case '+': case '=': api.setBubble(sel.index, scaleBubble(cur, BUBBLE_W.step)); break
          case '-': case '_': api.setBubble(sel.index, scaleBubble(cur, -BUBBLE_W.step)); break
          case 'Escape': api.clear(); break
          default: handled = false
        }
      }

      if (handled) e.preventDefault()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api, panelPolys])

  return { beginDrag, onPointerMove, onPointerUp, onWheel }
}
