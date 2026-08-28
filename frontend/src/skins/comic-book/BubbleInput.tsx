import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, PointerEvent } from 'react'

import type { BubbleContentKind } from './bubbleContent'
import { browserCountry, formatPhoneInput } from './phoneInput'
import { useDialCaret } from './useDialCaret'
import { usePhoneField } from './usePhoneField'
import { useRevealedField } from './useRevealedField'

interface BubbleInputProps {
  kind: Extract<BubbleContentKind, 'input' | 'phone'>
  initialValue: string
  font: string
  enabled: boolean
  /** Focus this field while its panel owns the keyboard. */
  revealed?: boolean
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
  kind, initialValue, font, enabled, revealed = false, onSubmit,
}: BubbleInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const country = useMemo(() => browserCountry(), [])
  const phone = kind === 'phone'
  const [value, setValue] = useState(() =>
    phone ? formatPhoneInput(initialValue, country) : initialValue,
  )
  // Format-as-you-type and digit-wise deletion, shared with the dial picker.
  const field = usePhoneField(inputRef, country, setValue)
  const caretRef = useDialCaret(inputRef, false)

  useRevealedField(inputRef, revealed, enabled)

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    if (!phone) {
      setValue(event.currentTarget.value)
      return
    }
    field.onChange(event)
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
    field.onDeleteKey(event, value)
  }

  const stopPointer = (event: PointerEvent<HTMLInputElement>): void => event.stopPropagation()

  return (
    <div
      className="cb-panel-bubble-text cb-bubble-field"
      style={{ fontFamily: `'${font}', cursive` }}
    >
      <input
        ref={inputRef}
        className="cb-bubble-input"
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
      <span
        ref={caretRef}
        className="cb-dial-caret"
        style={{ visibility: 'hidden' }}
        aria-hidden="true"
      />
    </div>
  )
}
