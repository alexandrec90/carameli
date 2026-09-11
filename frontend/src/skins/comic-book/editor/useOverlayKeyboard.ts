import { useEffect } from 'react'

import type { PanelPoly } from '../panelGeometry'
import { selectionBounds } from './selectionBounds'
import {
  BUBBLE_W,
  IMG_FRAME,
  IMG_SCALE,
  dragBubble,
  dragImg,
  dragImgFrame,
  scaleBubble,
  scaleImg,
  sizeImgFrame,
} from './transforms'
import type { BubbleTransform, ImgTransform } from './types'
import type { EditorModeApi } from './useEditorMode'

type Box = PanelPoly['bounds']

/** Unit arrow deltas, keyed by `KeyboardEvent.key`; scaled by the shift-aware step. */
const ARROW: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** Shift makes a nudge coarse. */
const COARSE_STEP = 10

/** `+1` to grow, `-1` to shrink, `null` when the key is not a zoom key. */
function zoomDir(key: string): number | null {
  if (key === '+' || key === '=') return 1
  if (key === '-' || key === '_') return -1
  return null
}

function isDeleteKey(key: string): boolean {
  return key === 'Delete' || key === 'Backspace'
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

/** Applies a shortcut to the selected picture. Returns whether the key was one. */
function imgKey(
  e: KeyboardEvent,
  api: EditorModeApi,
  index: number,
  cur: ImgTransform,
  bounds: Box,
): boolean {
  const arrow = ARROW[e.key]
  if (arrow) {
    const step = e.shiftKey ? COARSE_STEP : 1
    const [dx, dy] = [arrow[0] * step, arrow[1] * step]
    // Alt pans the picture behind its frame; without it the frame itself moves.
    const next = e.altKey
      ? dragImg(cur, dx, dy, bounds.w, bounds.h)
      : dragImgFrame(cur, dx, dy, bounds.w, bounds.h)
    api.setImg(index, next)
    return true
  }
  const dir = zoomDir(e.key)
  if (dir !== null) {
    // Alt sizes the frame; plain +/- zooms the picture inside it.
    const next = e.altKey
      ? sizeImgFrame(cur, dir * IMG_FRAME.step)
      : scaleImg(cur, dir * IMG_SCALE.step)
    api.setImg(index, next)
    return true
  }
  if (isDeleteKey(e.key)) {
    api.deleteImg(index)
    return true
  }
  if (e.key === 'Escape') {
    api.clear()
    return true
  }
  return false
}

/** Applies a shortcut to the selected bubble. Returns whether the key was one. */
function bubbleKey(
  e: KeyboardEvent,
  api: EditorModeApi,
  index: number,
  cur: BubbleTransform,
  bounds: Box,
): boolean {
  const arrow = ARROW[e.key]
  if (arrow) {
    const step = e.shiftKey ? COARSE_STEP : 1
    api.setBubble(index, dragBubble(cur, arrow[0] * step, arrow[1] * step, bounds.w, bounds.h))
    return true
  }
  const dir = zoomDir(e.key)
  if (dir !== null) {
    api.setBubble(index, scaleBubble(cur, dir * BUBBLE_W.step))
    return true
  }
  if (isDeleteKey(e.key)) {
    api.deleteBubble(index)
    return true
  }
  if (e.key === 'Escape') {
    api.clear()
    return true
  }
  return false
}

/**
 * Keyboard half of the dev editor overlay: arrows nudge (Shift = 10px, Alt on a picture
 * pans it inside its frame), +/- zoom or resize, Delete removes the selection, Esc
 * deselects. Split from `useOverlayInteraction` so each input path stays readable; both
 * measure against the same {@link selectionBounds}.
 */
export function useOverlayKeyboard(api: EditorModeApi, panelPolys: (PanelPoly | null)[]): void {
  useEffect(() => {
    const sel = api.selected
    if (!sel) return

    const onKey = (e: KeyboardEvent) => {
      // The author typing into the inspector is not a shortcut. Without this an arrow
      // key meant for the caret in the bubble text area moves the bubble instead.
      if (isTypingTarget(e.target)) return

      const bounds = selectionBounds(api, panelPolys)
      let handled: boolean
      if (sel.kind === 'img') {
        const cur = api.config.images[sel.index]
        if (!cur || !bounds) return
        handled = imgKey(e, api, sel.index, cur, bounds)
      } else if (sel.kind === 'bubble') {
        const cur = api.config.bubbles[sel.index]
        if (!cur || !bounds) return
        handled = bubbleKey(e, api, sel.index, cur, bounds)
      } else {
        // A selected panel has nothing to nudge — it is a slot, not a drawn thing.
        handled = e.key === 'Escape'
        if (handled) api.clear()
      }

      if (handled) e.preventDefault()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api, panelPolys])
}
