import { useEffect, useRef } from 'react'
import type { ChangeEvent, KeyboardEvent, RefObject } from 'react'
import type { CountryCode } from 'libphonenumber-js/min'

import {
  caretAfterDigits,
  deleteAdjacentDigit,
  digitsBefore,
  formatPhoneInput,
} from './phoneInput'

export interface PhoneField {
  /**
   * Reformat `raw`, report it, and put the caret back after the same digit it was after
   * before. `force` restores the caret even when formatting changed nothing — which is
   * what a key the component handled itself needs, since the browser never moved it.
   */
  commit(raw: string, digitCaret: number, force?: boolean): void
  /** The field's `onChange`: format-as-you-type without the caret jumping to the end. */
  onChange(event: ChangeEvent<HTMLInputElement>): void
  /**
   * Backspace and Delete over the formatter's own punctuation. True when it took the
   * key — `preventDefault` has already been called — false when native editing should
   * have it, which is a leading `+`, a selection, or an empty field.
   */
  onDeleteKey(event: KeyboardEvent<HTMLInputElement>, value: string): boolean
}

/**
 * Editing a phone number in place, which is three problems rather than one: the value is
 * reformatted on every keystroke, the caret has to survive that, and Backspace has to
 * delete a *digit* rather than whichever bracket or dash the formatter put next to it.
 *
 * Extracted from BubbleInput so the dial picker (BubbleDial) is the same field rather
 * than a second implementation of it — the two disagreeing about where the caret goes
 * would be invisible until somebody edited the middle of a number.
 *
 * The value itself stays the caller's: this hook holds no state, only the animation
 * frame the caret restore is deferred to. That is what lets BubbleDial hand its value up
 * to the panel — where the projected keypad can also write to it — while BubbleInput
 * keeps its own.
 */
export function usePhoneField(
  inputRef: RefObject<HTMLInputElement | null>,
  country: CountryCode | undefined,
  emit: (value: string) => void,
): PhoneField {
  const frameRef = useRef(0)

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  const commit = (raw: string, digitCaret: number, force = false): void => {
    const formatted = formatPhoneInput(raw, country)
    emit(formatted)
    // Formatting moved nothing, so the caret the browser already placed is the right
    // one. Restoring it anyway would send it to "after digit N" — the front of the
    // value, for a `*` or `#` typed past the last digit.
    if (!force && formatted === raw) return
    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      const caret = caretAfterDigits(formatted, digitCaret)
      inputRef.current?.setSelectionRange(caret, caret)
    })
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.currentTarget.value
    const caret = event.currentTarget.selectionStart ?? next.length
    commit(next, digitsBefore(next, caret))
  }

  const onDeleteKey = (event: KeyboardEvent<HTMLInputElement>, value: string): boolean => {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return false
    const start = event.currentTarget.selectionStart
    const end = event.currentTarget.selectionEnd
    if (start == null || end == null || start !== end) return false
    const deletion = deleteAdjacentDigit(
      value,
      start,
      event.key === 'Backspace' ? 'backward' : 'forward',
    )
    if (!deletion) return false
    event.preventDefault()
    commit(deletion.value, deletion.digitsBefore, true)
    return true
  }

  return { commit, onChange, onDeleteKey }
}
