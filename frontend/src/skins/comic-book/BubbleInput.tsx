import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, PointerEvent } from 'react'

import type { BubbleContentKind } from './bubbleContent'
import {
  browserCountry,
  caretAfterDigits,
  deleteAdjacentDigit,
  digitsBefore,
  formatPhoneInput,
} from './phoneInput'

interface BubbleInputProps {
  kind: Extract<BubbleContentKind, 'input' | 'phone'>
  initialValue: string
  font: string
  enabled: boolean
  /**
   * Called with the trimmed value when Enter is pressed, after which the field clears.
   * Absent — the ordinary case — leaves Enter doing nothing, because a lone input balloon
   * has nowhere to send anything and emptying itself would just lose what was typed. A
   * chain's composer supplies it (see PanelBubbleChain), and so does a standalone `phone`
   * balloon, where Enter places the call (see PanelBubbles).
   */
  onSubmit?: (value: string) => void
}

/** A real, single-line input fitted inside a speech bubble. */
export default function BubbleInput({
  kind, initialValue, font, enabled, onSubmit,
}: BubbleInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const frameRef = useRef(0)
  const country = useMemo(() => browserCountry(), [])
  const phone = kind === 'phone'
  const [value, setValue] = useState(() =>
    phone ? formatPhoneInput(initialValue, country) : initialValue,
  )

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  const commitPhone = (raw: string, digitCaret: number): void => {
    const formatted = formatPhoneInput(raw, country)
    setValue(formatted)
    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      const caret = caretAfterDigits(formatted, digitCaret)
      inputRef.current?.setSelectionRange(caret, caret)
    })
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    if (!phone) {
      setValue(event.currentTarget.value)
      return
    }
    const caret = event.currentTarget.selectionStart ?? event.currentTarget.value.length
    commitPhone(event.currentTarget.value, digitsBefore(event.currentTarget.value, caret))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation()
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Enter' && onSubmit) {
      // Prevented whether or not anything is sent: inside a form this would submit it,
      // and an empty composer is a keystroke that should do nothing at all rather than
      // navigate. Trimmed because a message of spaces is an empty balloon.
      event.preventDefault()
      const text = value.trim()
      if (text === '') return
      onSubmit(text)
      setValue('')
      return
    }
    if (!phone) return
    if (event.key !== 'Backspace' && event.key !== 'Delete') return
    const start = event.currentTarget.selectionStart
    const end = event.currentTarget.selectionEnd
    if (start == null || end == null || start !== end) return
    const deletion = deleteAdjacentDigit(
      value,
      start,
      event.key === 'Backspace' ? 'backward' : 'forward',
    )
    if (!deletion) return
    event.preventDefault()
    commitPhone(deletion.value, deletion.digitsBefore)
  }

  const stopPointer = (event: PointerEvent<HTMLInputElement>): void => event.stopPropagation()

  return (
    <input
      ref={inputRef}
      className="cb-panel-bubble-text cb-bubble-input"
      style={{ fontFamily: `'${font}', cursive` }}
      type={phone ? 'tel' : 'text'}
      inputMode={phone ? 'tel' : 'text'}
      autoComplete={phone ? 'tel' : 'off'}
      aria-label={phone ? 'Phone number' : 'Speech bubble text'}
      disabled={!enabled}
      tabIndex={enabled ? 0 : -1}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onPointerDown={stopPointer}
      onClick={event => event.stopPropagation()}
    />
  )
}
