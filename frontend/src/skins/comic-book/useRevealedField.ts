import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Give a revealed panel field the keyboard, place its caret at the end — and **keep** it
 * there for as long as the panel keeps offering it.
 *
 * The reveal is the invitation (panelKeyboard.ts): a field on a lit panel is typed into
 * with no click, so it has to stop being typed into for a reason the reader can see —
 * the pointer leaving the panel, or arriving on another field beside it. A click on the
 * artwork is neither. Focusing once was enough only until somebody clicked: the browser
 * moved focus to the body, nothing in React had changed, so the effect never re-ran and
 * the panel sat lit with a dead field in it. Every keystroke after that went nowhere, and
 * the way back was a click *on the balloon* — the ritual this skin does not have.
 *
 * So a focus that goes **nowhere** is taken back. `relatedTarget` is what tells the two
 * apart, and it is exactly the right question: a click on a panel, a picture or a
 * balloon's outline lands on nothing focusable and reports null, while Tab to the next
 * control, a press on the telephone's call key, or the field in the balloon beside this
 * one all name where the keyboard went. Those are deliberate and this hook does not undo
 * them — undoing them would trap Tab on a page whose controls are otherwise unreachable.
 */
export function useRevealedField(
  inputRef: RefObject<HTMLInputElement | null>,
  revealed: boolean,
  enabled: boolean,
): void {
  useEffect(() => {
    const input = inputRef.current
    if (!input || !enabled) return
    if (!revealed) {
      if (document.activeElement === input) input.blur()
      return
    }
    if (document.activeElement !== input) {
      input.focus({ preventScroll: true })
      input.setSelectionRange(input.value.length, input.value.length)
    }
    let frame = 0
    const onFocusOut = (event: FocusEvent): void => {
      if (event.relatedTarget !== null) return
      // Where the reader was, not the end of the value: this is a restore, and a caret
      // that jumped to the end would make a stray click on the artwork edit the number.
      const start = input.selectionStart
      const end = input.selectionEnd
      // Deferred by a frame because this blur *is* the pointer press's default action
      // still running, and a focus() called from inside it is undone by the rest of that
      // action. The frame also lets a reveal that is ending win: leaving the panel
      // cancels it below before it can fire.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (document.activeElement === input) return
        input.focus({ preventScroll: true })
        if (start !== null && end !== null) input.setSelectionRange(start, end)
      })
    }
    input.addEventListener('focusout', onFocusOut)
    return () => {
      cancelAnimationFrame(frame)
      input.removeEventListener('focusout', onFocusOut)
    }
  }, [inputRef, revealed, enabled])
}
