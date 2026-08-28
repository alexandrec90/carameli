import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { dialCaretLeft, dialCaretShown } from './dialCaret'

/**
 * The comic caret: a slanted ink block stood where the native caret would blink
 * (`.cb-dial-caret` in bubbleDial.css — the native one is transparent there).
 *
 * Placed imperatively, not from state: the caret moves on events that never re-render
 * the component — a click inside the value, an arrow key the browser handled — so the
 * position is written straight onto the element on every `selectionchange`. Width is
 * measured on a throwaway canvas in the field's own font; the field centres its text,
 * so the caret is the centred line's left edge plus the width of what precedes it
 * (`dialCaret.ts`). Where a canvas cannot measure (jsdom), the caret still shows and
 * hides — it just stays at the left edge, which no test asserts against.
 */
export function useDialCaret(inputRef: RefObject<HTMLInputElement | null>) {
  const caretRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<CanvasRenderingContext2D | null>(null)

  useEffect(() => {
    const input = inputRef.current
    const caret = caretRef.current
    if (!input || !caret) return
    const place = (): void => {
      const shown = dialCaretShown(
        document.activeElement === input,
        input.selectionStart,
        input.selectionEnd,
      )
      caret.style.visibility = shown ? 'visible' : 'hidden'
      if (!shown) return
      measureRef.current ??= document.createElement('canvas').getContext('2d')
      const ctx = measureRef.current
      if (!ctx) return
      const cs = getComputedStyle(input)
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const at = input.selectionStart ?? input.value.length
      const padLeft = parseFloat(cs.paddingLeft) || 0
      const padRight = parseFloat(cs.paddingRight) || 0
      const left = dialCaretLeft(
        padLeft,
        input.clientWidth - padLeft - padRight,
        ctx.measureText(input.value).width,
        ctx.measureText(input.value.slice(0, at)).width,
      )
      caret.style.left = `${left}px`
    }
    place()
    input.addEventListener('focus', place)
    input.addEventListener('blur', place)
    // `select` as well as `selectionchange`: a selection made without the pointer —
    // Ctrl+A, or a setSelectionRange like the reveal's caret placement — announces
    // itself through the former, and synchronously.
    input.addEventListener('select', place)
    document.addEventListener('selectionchange', place)
    return () => {
      input.removeEventListener('focus', place)
      input.removeEventListener('blur', place)
      input.removeEventListener('select', place)
      document.removeEventListener('selectionchange', place)
    }
  })

  return caretRef
}
