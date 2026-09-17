import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react'

import type { BubbleContentKind } from './bubbleContent'
import { textInsetStyle } from './bubbleText'
import type { BubbleType } from './editor/bubbleTypes'
import { browserCountry, formatPhoneInput } from './phoneInput'
import { useDialCaret } from './useDialCaret'
import { usePhoneField } from './usePhoneField'
import { useRevealedField } from './useRevealedField'

/** Either element this balloon's field can be — see `wraps`. */
type Field = HTMLInputElement | HTMLTextAreaElement

interface BubbleInputProps {
  kind: Extract<BubbleContentKind, 'input' | 'phone'>
  initialValue: string
  /**
   * The shape the balloon is drawn as right now, which is what the field's block is
   * inscribed in (bubbleText.ts) — the same inset a composer's balloon was fitted against
   * (bubbleFit.ts), so the words wrap at the width the fit assumed rather than at the
   * stylesheet's fallback.
   */
  shape: BubbleType
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
  /**
   * Called with the field's contents on every change, for whoever is drawing the balloon
   * around it. A chain's composer supplies it: the balloon is fitted to that same draft
   * (`fitRow` in chainRows.ts), so the ink grows with the words.
   *
   * **Its presence is what makes a plain-text field wrap** rather than scroll its words
   * sideways, and that is deliberately one question rather than two. Wrapping inside a
   * balloon nobody is resizing would push the second line straight out through the
   * outline — which is the failure wrapping is here to fix, not a different one. A
   * `phone` field never wraps whoever is listening: a number is one line by nature, and
   * the formatter, the digit-wise delete and the caret arithmetic all read it as one.
   */
  onDraftChange?: (value: string) => void
}

/**
 * A real editable field fitted inside a speech bubble.
 *
 * One line by default, and **wrapping when the balloon around it is being fitted to what
 * is typed** (see `onDraftChange`) — a composer, where the words have somewhere to grow
 * into. The wrapping form is a `textarea` rather than an `input` because no input wraps:
 * a long message in one scrolled the sentence sideways out of sight inside a balloon that
 * stayed the size the author drew it.
 */
export default function BubbleInput({
  kind, initialValue, shape, font, enabled, revealed = false, onSubmit, onDraftChange,
}: BubbleInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const country = useMemo(() => browserCountry(), [])
  const phone = kind === 'phone'
  // See `onDraftChange`: a field wraps exactly when something is sizing its balloon.
  const wraps = !phone && onDraftChange !== undefined
  const fieldRef = wraps ? areaRef : inputRef
  const [value, setValue] = useState(() =>
    phone ? formatPhoneInput(initialValue, country) : initialValue,
  )
  // Format-as-you-type and digit-wise deletion, shared with the dial picker. Only ever the
  // `input` element, which is the only one a phone field is ever drawn as.
  //
  // It reports through `setValue` rather than `apply`, so a *phone* composer never tells
  // its chain what is in it and its balloon stays the one the author drew. That is the
  // answer a number wants: the field is one line by construction, so a balloon grown
  // around a wrap the field will not do would be taller than anything it shows.
  const field = usePhoneField(inputRef, country, setValue)
  const caretRef = useDialCaret(fieldRef, false, wraps)

  useRevealedField(fieldRef, revealed, enabled)

  // Grow the field to the lines its words actually took.
  //
  // The balloon around it was sized from an estimate that errs roomy on purpose
  // (bubbleFit.ts), so this is what keeps the lettering centred in that room rather than
  // sitting high with blank lines beneath it. It reads the *field's own* content height,
  // which is not the page geometry the skin refuses to measure: every balloon, row and
  // tube is still a share of the frame, and nothing here feeds back into one.
  //
  // `scrollHeight` is 0 where there is no layout at all (jsdom), and the height is then
  // left to the stylesheet's single row rather than collapsed to nothing.
  useLayoutEffect(() => {
    const area = areaRef.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = area.scrollHeight > 0 ? `${area.scrollHeight}px` : ''
  }, [value, wraps])

  /** Take `next` as the field's contents, and tell whoever is drawing the balloon. */
  const apply = (next: string): void => {
    setValue(next)
    onDraftChange?.(next)
  }

  const onChange = (event: ChangeEvent<Field>): void => {
    if (!phone) {
      apply(event.currentTarget.value)
      return
    }
    field.onChange(event as ChangeEvent<HTMLInputElement>)
  }

  const onKeyDown = (event: KeyboardEvent<Field>): void => {
    event.stopPropagation()
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Enter' && onSubmit) {
      // Prevented whether or not anything is sent: inside a form this would submit it, in
      // a wrapping field it would open a second line no transcript has a way to carry,
      // and an empty composer is a keystroke that should do nothing at all rather than
      // navigate. Trimmed because a message of spaces is an empty balloon.
      event.preventDefault()
      const text = value.trim()
      if (text === '') return
      onSubmit(text)
      apply('')
      return
    }
    if (!phone) return
    field.onDeleteKey(event as KeyboardEvent<HTMLInputElement>, value)
  }

  /** What both forms of the field carry: the value, the editing, and the pointer stops. */
  const shared = {
    className: 'cb-bubble-input',
    'aria-label': phone ? 'Phone number' : 'Speech bubble text',
    disabled: !enabled,
    tabIndex: enabled ? 0 : -1,
    value,
    onChange,
    onKeyDown,
    onPointerDown: (event: PointerEvent<Field>) => event.stopPropagation(),
    onClick: (event: MouseEvent<Field>) => event.stopPropagation(),
  }

  return (
    <div
      className={`cb-panel-bubble-text cb-bubble-field${wraps ? ' cb-bubble-wrapping' : ''}`}
      style={{ fontFamily: `'${font}', cursive`, ...textInsetStyle(shape) }}
    >
      {wraps ? (
        // One row in the markup however many it ends up drawing: the height is set above
        // from what the words took, and `rows` is only the floor an empty field keeps so
        // there is a line for the caret to stand on.
        <textarea ref={areaRef} rows={1} {...shared} />
      ) : (
        <input
          ref={inputRef}
          type={phone ? 'tel' : 'text'}
          inputMode={phone ? 'tel' : 'text'}
          autoComplete={phone ? 'tel' : 'off'}
          {...shared}
        />
      )}
      <span
        ref={caretRef}
        className="cb-dial-caret"
        style={{ visibility: 'hidden' }}
        aria-hidden="true"
      />
    </div>
  )
}
