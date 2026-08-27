import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'

import { dialOptionIndex } from './dialPicker'
import { browserCountry, formatPhoneInput } from './phoneInput'
import { usePhoneField } from './usePhoneField'
import { clampIndex, wheelOffsetEm, wheelSteps } from './wheelPicker'
import './bubbleDial.css'

interface BubbleDialProps {
  /** The option list, already split from the bubble's comma-delimited text. */
  options: string[]
  /** The dialled number, formatted. Owned by the panel — see ComicPanel. */
  value: string
  /** Called with the new formatted value on every turn, keystroke and keypad press. */
  onChange(next: string): void
  /** Lettering font for the current shape, same as the plain-text span uses. */
  font: string
  /** True while the pointer is over the bubble: the unpicked options fade in. */
  open: boolean
  /** False in edit mode: the editor overlay owns the pointer and the keyboard there. */
  enabled: boolean
  /**
   * The bubble's root element. The wheel listener goes on the whole balloon, not on
   * this component's own box, so scrolling anywhere over the bubble turns the picker.
   */
  hostRef: RefObject<HTMLDivElement | null>
  /** Enter dials the number. Absent leaves Enter doing nothing. */
  onSubmit?(value: string): void
}

/**
 * The 'dial' content kind: a wheel picker whose picked row is a real phone field.
 *
 * A wheel balloon can only offer what the author typed and an input balloon can only be
 * typed into; a phone is both — a shortlist you turn to, and a keypad for everything
 * that is not on it. So the drum draws the options and the field draws the value, one
 * over the other in the same window, and the picked row is hidden behind the field
 * because the two would otherwise letter the same number twice.
 *
 * **The value is not held here.** It belongs to the panel (ComicPanel), because the
 * projected keypad on the *picture* beside this balloon writes to it too — a number
 * punched into the phone in the photograph and a number typed into the balloon are one
 * number, and a component owning its own state could not be told about the first. That
 * is also what keeps the drum honest: turning it reports an option, typing an option's
 * own digits turns the drum to it (`dialOptionIndex`), and neither is a special case of
 * the other.
 *
 * Turning is `wheelPicker.ts` exactly as BubbleWheel uses it, and editing is
 * `usePhoneField` exactly as BubbleInput uses it. Nothing about either is re-implemented
 * here; what is new is only that they are the same value.
 */
export default function BubbleDial({
  options, value, onChange, font, open, enabled, hostRef, onSubmit,
}: BubbleDialProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const country = useMemo(() => browserCountry(), [])
  const field = usePhoneField(inputRef, country, onChange)
  const count = options.length

  const [index, setIndex] = useState(0)
  // The drum position as the listeners see it. A ref as well as state because the wheel
  // handler is registered once and would otherwise read the index of the render that
  // registered it — which swallows every turn but the first of a fast scroll.
  const indexRef = useRef(0)
  // Sub-step wheel travel carried between events (see wheelSteps).
  const accRef = useRef(0)
  // One turn, defined once and called from both the wheel and the arrow keys. Kept in a
  // ref and refreshed after every commit so the listener below can be registered per
  // host rather than per render, without ever calling a stale `onChange`.
  const turnRef = useRef<(steps: number) => void>(() => undefined)

  // Which option the value *is*, or -1 while it is something the author never listed —
  // a number part-way typed, or one the reader punched in from the keypad.
  const matched = dialOptionIndex(options, value)

  useEffect(() => {
    turnRef.current = (steps: number) => {
      if (count === 0) return
      const next = clampIndex(indexRef.current + steps, count)
      if (next === indexRef.current) return
      indexRef.current = next
      setIndex(next)
      onChange(formatPhoneInput(options[next] ?? '', country))
    }
  })

  // The field and the drum are two views of one value: type an option's own number and
  // the drum turns to it, so it is never showing a different number than the field.
  useEffect(() => {
    if (matched >= 0 && matched !== indexRef.current) {
      indexRef.current = matched
      setIndex(matched)
    }
  }, [matched])

  // The inspector can edit options out from under the drum; keep it in range.
  useEffect(() => {
    const next = clampIndex(indexRef.current, Math.max(count, 1))
    indexRef.current = next
    setIndex(next)
  }, [count])

  useEffect(() => {
    const host = hostRef.current
    if (!host || count === 0 || !enabled) return
    const onWheel = (e: WheelEvent) => {
      // Native and non-passive on purpose: React registers its wheel listeners passive,
      // and a passive handler cannot keep the page from scrolling away under the picker.
      e.preventDefault()
      const { acc, steps } = wheelSteps(accRef.current, e.deltaY)
      accRef.current = acc
      if (steps !== 0) turnRef.current(steps)
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [hostRef, count, enabled])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation()
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Enter' && onSubmit) {
      event.preventDefault()
      const dialled = value.trim()
      // Kept rather than cleared, unlike a composer: the number stays on the display
      // after it is dialled, the way it does on the phone in the picture.
      if (dialled !== '') onSubmit(dialled)
      return
    }
    // The wheel's keyboard equivalent. Without it the options are reachable by exactly
    // one device, and the arrows would otherwise only jump the caret within the field.
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      turnRef.current(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    field.onDeleteKey(event, value)
  }

  const stopPointer = (event: PointerEvent<HTMLInputElement>): void => event.stopPropagation()

  return (
    <div
      className={`cb-panel-bubble-text cb-bubble-wheel cb-bubble-dial${open ? ' is-open' : ''}`}
      style={{ fontFamily: `'${font}', cursive` }}
    >
      {/* The options behind the window. Decorative: the picked row is hidden under the
          field, and every other row is a number the field can be turned to. */}
      <div
        className="cb-wheel-track"
        style={{ transform: `translateY(${wheelOffsetEm(index)}em)` }}
        aria-hidden="true"
      >
        {options.map((opt, i) => (
          <div key={i} className={`cb-wheel-option${i === index ? ' is-selected' : ''}`}>
            {opt}
          </div>
        ))}
      </div>
      <input
        ref={inputRef}
        className="cb-bubble-input cb-dial-field"
        style={{ fontFamily: `'${font}', cursive` }}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        aria-label="Phone number"
        disabled={!enabled}
        tabIndex={enabled ? 0 : -1}
        value={value}
        onChange={field.onChange}
        onKeyDown={onKeyDown}
        onPointerDown={stopPointer}
        onClick={event => event.stopPropagation()}
      />
    </div>
  )
}
