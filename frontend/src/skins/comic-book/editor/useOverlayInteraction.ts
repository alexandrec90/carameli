import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'

import type { PanelPoly } from '../panelGeometry'
import {
  BUBBLE_W,
  IMG_FRAME,
  IMG_SCALE,
  dragBubble,
  dragImg,
  dragImgFrame,
  resizeBubble,
  resizeImgFrame,
  rotateBubble,
  scaleBubble,
  scaleImg,
  sizeImgFrame,
} from './transforms'
import type { BubbleTransform, ImgTransform } from './types'
import type { EditorModeApi } from './useEditorMode'

/**
 * What a pointer drag is doing to the selected target.
 *
 * `move` and `pan` are two different gestures on a picture and used to be one: `move`
 * slides the frame across the panel, `pan` slides the picture behind the frame. They
 * were indistinguishable while a picture's frame *was* its panel and could not move.
 */
export type DragMode = 'move' | 'resize' | 'rotate' | 'pan'

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
 * Panel box the current selection is measured against: the box of the panel the
 * selected entry *names*, never `panelPolys[selection.index]` — neither array lines up
 * with the panels any more, since a panel may own several pictures and several
 * bubbles. Getting this wrong scales a drag by another panel's dimensions, so it is
 * resolved in one place for every input path.
 */
function selectionBounds(
  api: EditorModeApi,
  panelPolys: (PanelPoly | null)[],
): PanelPoly['bounds'] | null {
  const sel = api.selected
  if (!sel) return null
  const panel =
    sel.kind === 'panel'
      ? sel.index
      : sel.kind === 'img'
        ? api.config.images[sel.index]?.panel
        : api.config.bubbles[sel.index]?.panel
  return panel === undefined ? null : (panelPolys[panel]?.bounds ?? null)
}

/**
 * True when a key event is the author typing into a field — the bubble text area, a
 * number input, a dropdown. The shortcuts below are on `window`, so without this an
 * arrow key meant to move the caret nudges the selection instead, and a typed `-`
 * shrinks it.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Wires pointer + keyboard input for the dev editor overlay to the pure transform
 * helpers and `useEditorMode` mutators. The handler bodies stay thin: they read the
 * drag's *starting* transform, hand a px delta to a pure helper, and commit the
 * result — so they are correct regardless of React batching during a fast drag.
 */
export function useOverlayInteraction(
  api: EditorModeApi,
  panelPolys: (PanelPoly | null)[],
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
    const bounds = selectionBounds(api, panelPolys)
    if (!bounds) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY

    if (sel.kind === 'img' && d.startImg) {
      const next =
        d.mode === 'pan'
          ? dragImg(d.startImg, dx, dy)
          : d.mode === 'resize'
            ? resizeImgFrame(d.startImg, dx, dy, bounds.w, bounds.h)
            : dragImgFrame(d.startImg, dx, dy, bounds.w, bounds.h)
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
    if (sel?.kind === 'img') {
      const cur = api.config.images[sel.index]
      if (cur) api.setImg(sel.index, scaleImg(cur, -e.deltaY * WHEEL_SCALE))
    } else if (sel?.kind === 'bubble') {
      const cur = api.config.bubbles[sel.index]
      if (cur) api.setBubble(sel.index, scaleBubble(cur, -e.deltaY * WHEEL_BUBBLE_W))
    }
  }

  // Keyboard: arrows nudge (Shift = 10px, Alt on a picture pans it inside its frame),
  // +/- zoom or resize, Delete removes the selection, Esc deselects.
  useEffect(() => {
    const sel = api.selected
    if (!sel) return

    const onKey = (e: KeyboardEvent) => {
      // The author typing into the inspector is not a shortcut. Without this an arrow
      // key meant for the caret in the bubble text area moves the bubble instead.
      if (isTypingTarget(e.target)) return

      const step = e.shiftKey ? 10 : 1
      const bounds = selectionBounds(api, panelPolys)
      let handled = true

      if (sel.kind === 'img') {
        const cur = api.config.images[sel.index]
        if (!cur || !bounds) return
        // Alt pans the picture behind its frame; without it the frame itself moves.
        const nudge = (dx: number, dy: number): ImgTransform =>
          e.altKey ? dragImg(cur, dx, dy) : dragImgFrame(cur, dx, dy, bounds.w, bounds.h)
        switch (e.key) {
          case 'ArrowLeft': api.setImg(sel.index, nudge(-step, 0)); break
          case 'ArrowRight': api.setImg(sel.index, nudge(step, 0)); break
          case 'ArrowUp': api.setImg(sel.index, nudge(0, -step)); break
          case 'ArrowDown': api.setImg(sel.index, nudge(0, step)); break
          // Alt sizes the frame; plain +/- zooms the picture inside it.
          case '+': case '=':
            api.setImg(
              sel.index,
              e.altKey ? sizeImgFrame(cur, IMG_FRAME.step) : scaleImg(cur, IMG_SCALE.step),
            )
            break
          case '-': case '_':
            api.setImg(
              sel.index,
              e.altKey ? sizeImgFrame(cur, -IMG_FRAME.step) : scaleImg(cur, -IMG_SCALE.step),
            )
            break
          case 'Delete': case 'Backspace': api.deleteImg(sel.index); break
          case 'Escape': api.clear(); break
          default: handled = false
        }
      } else if (sel.kind === 'bubble') {
        const cur = api.config.bubbles[sel.index]
        if (!cur || !bounds) return
        switch (e.key) {
          case 'ArrowLeft': api.setBubble(sel.index, dragBubble(cur, -step, 0, bounds.w, bounds.h)); break
          case 'ArrowRight': api.setBubble(sel.index, dragBubble(cur, step, 0, bounds.w, bounds.h)); break
          case 'ArrowUp': api.setBubble(sel.index, dragBubble(cur, 0, -step, bounds.w, bounds.h)); break
          case 'ArrowDown': api.setBubble(sel.index, dragBubble(cur, 0, step, bounds.w, bounds.h)); break
          case '+': case '=': api.setBubble(sel.index, scaleBubble(cur, BUBBLE_W.step)); break
          case '-': case '_': api.setBubble(sel.index, scaleBubble(cur, -BUBBLE_W.step)); break
          case 'Delete': case 'Backspace': api.deleteBubble(sel.index); break
          case 'Escape': api.clear(); break
          default: handled = false
        }
      } else {
        // A selected panel has nothing to nudge — it is a slot, not a drawn thing.
        if (e.key === 'Escape') api.clear()
        else handled = false
      }

      if (handled) e.preventDefault()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api, panelPolys])

  return { beginDrag, onPointerMove, onPointerUp, onWheel }
}
