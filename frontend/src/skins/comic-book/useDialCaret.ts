import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import {
  caretLineIndex, caretLineTop, dialCaretLeft, dialCaretShown, wrapCaretLines,
} from './dialCaret'

/**
 * The comic caret: a slanted ink block stood where the native caret would blink
 * (`.cb-dial-caret` in bubbleInputs.css — the native one is transparent there).
 *
 * Placed imperatively, not from state: the caret moves on events that never re-render
 * the component — a click inside the value, an arrow key the browser handled — so the
 * position is written straight onto the element on every `selectionchange`. Width is
 * measured on a throwaway canvas in the field's own font; the field centres its text,
 * so the caret is the centred line's left edge plus the width of what precedes it
 * (`dialCaret.ts`). Where a canvas cannot measure (jsdom), the caret still shows and
 * hides — it just stays at the left edge, which no test asserts against.
 *
 * `wraps` is a field whose words run onto more than one line — a chain's composer, and
 * nothing else (see BubbleInput). There the caret also has a line to find, so the value is
 * broken at the same places the browser broke it (`wrapCaretLines`) and the caret is
 * offset down onto its own line; the stylesheet's single centred line is what it keeps
 * otherwise.
 */
export function useDialCaret(
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  fresh: boolean,
  wraps = false,
) {
  const caretRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<CanvasRenderingContext2D | null>(null)

  // No dependency array, deliberately: the effect re-runs on every render, so `place`
  // always closes over the current `fresh` — a turn flips it without any selection
  // event, and the re-registration is what repaints the caret for it.
  useEffect(() => {
    const input = inputRef.current
    const caret = caretRef.current
    if (!input || !caret) return
    const place = (): void => {
      const shown = dialCaretShown(
        document.activeElement === input,
        fresh,
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
      const measure = (run: string): number => ctx.measureText(run).width
      const at = input.selectionStart ?? input.value.length
      const padLeft = parseFloat(cs.paddingLeft) || 0
      const padRight = parseFloat(cs.paddingRight) || 0
      const content = input.clientWidth - padLeft - padRight
      // One line for a field that does not wrap, which is the whole value — the same
      // answer the arithmetic below gives, reached without measuring the value twice.
      const lines = wraps
        ? wrapCaretLines(input.value, content, measure)
        : [{ start: 0, text: input.value }]
      const index = caretLineIndex(lines, at)
      const line = lines[index]
      caret.style.left = `${dialCaretLeft(
        padLeft,
        content,
        measure(line.text),
        measure(input.value.slice(line.start, at)),
      )}px`
      if (!wraps) return
      // The field is centred in its balloon and only as tall as its words (BubbleInput),
      // so the caret's line is measured from the field's own top rather than the block's.
      const lineHeight = parseFloat(cs.lineHeight) || 0
      const top = input.offsetTop
        + caretLineTop(parseFloat(cs.paddingTop) || 0, lineHeight, index)
        + lineHeight / 2
      caret.style.top = `${top}px`
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
