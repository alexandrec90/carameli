import { useEffect } from 'react'
import type { RefObject } from 'react'

/** Give a revealed panel field the keyboard, placing its caret at the end. */
export function useRevealedField(
  inputRef: RefObject<HTMLInputElement | null>,
  revealed: boolean,
  enabled: boolean,
): void {
  useEffect(() => {
    const input = inputRef.current
    if (!input || !enabled) return
    if (revealed && document.activeElement !== input) {
      input.focus({ preventScroll: true })
      input.setSelectionRange(input.value.length, input.value.length)
    } else if (!revealed && document.activeElement === input) input.blur()
  }, [inputRef, revealed, enabled])
}
