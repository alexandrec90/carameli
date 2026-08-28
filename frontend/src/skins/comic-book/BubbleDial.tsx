import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'

import {
  dialDigits,
  dialMatches,
  dialRowValue,
  dialSeat,
  dialTurn,
  dialTyped,
} from './dialPicker'
import type { DialState } from './dialPicker'
import { browserCountry, formatPhoneInput } from './phoneInput'
import { useDialCaret } from './useDialCaret'
import { useDialWheel } from './useDialWheel'
import { usePhoneField } from './usePhoneField'
import { wheelOffsetEm } from './wheelPicker'
import './bubbleDial.css'

interface BubbleDialProps {
  /**
   * The shortlist, already split from the bubble's comma-delimited text and already
   * grown by whatever has been dialled on this panel (see `dialOptions`).
   */
  options: string[]
  /** The dialled number, formatted. Owned by the panel — see ComicPanel. */
  value: string
  /**
   * True while `value` is a number the drum supplied — the seeded option, a row a turn
   * landed on, a number just dialled — rather than one the reader typed. A fresh number
   * is finished: the next character starts a new number instead of appending, which
   * could only produce a number no option contains and so empties the shortlist on the
   * first key. Owned by the panel beside the value, because the projected keypad writes
   * to the same number and must obey the same rule (see ComicPanel).
   */
  fresh: boolean
  /**
   * Called with the new formatted value on every turn and keystroke, and with what
   * `fresh` becomes: true from a turn that landed on a row, false for anything typed.
   */
  onChange(next: string, fresh: boolean): void
  /** Lettering font for the current shape, same as the plain-text span uses. */
  font: string
  /** True while the balloon is hovered or its field has focus: the shortlist fades in. */
  open: boolean
  /**
   * True while the balloon is revealed by its panel being hovered. The dial is the
   * panel's only input, so revealing it hands it the keyboard without a click, and
   * hiding it gives the keyboard back. A separate prop from `open`, which includes the
   * field's own focus and so could never let go of it.
   */
  revealed: boolean
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
 * The 'dial' content kind: one window that is a phone field and its own shortlist.
 *
 * A wheel balloon can only offer what the author typed and an input balloon can only be
 * typed into; a phone is both. So this is an **autocomplete whose list is a wheel**: the
 * field letters the balloon's centre line, the options the typed number narrows to hang
 * off it above and below, and one gesture — a scroll, or an arrow key — moves between
 * them. There is no second control beside the drum, because a balloon has room for one
 * thing.
 *
 * `dialPicker.ts` holds the model, and the module comment there describes the rows. What
 * is left here is the wiring, and it is three rules:
 *
 * - **Turning reports a row.** `dialTurn` moves the drum, `dialRowValue` says what it
 *   landed on, and that is the new value.
 * - **Anything else that changes the value re-filters.** The value can move without the
 *   drum — a keystroke, or the number pad projected onto a picture in the same panel —
 *   and whenever it stops being the row the drum is on, that new number becomes the
 *   filter and the drum returns to the typed row. One rule covers typing, the pad, and
 *   the author re-seeding the balloon, so none of them is a special case.
 * - **The shortlist changing re-seats the drum.** Dialling appends the number to the
 *   options (ComicPanel), so this is what turns the number the reader just called into
 *   an ordinary row of the drum, with the filter cleared and the whole list back.
 *
 * **The value is not held here.** It belongs to the panel (ComicPanel), because the
 * projected keypad on the *picture* beside this balloon writes to it too — a number
 * punched into the phone in the photograph and a number typed into the balloon are one
 * number, and a component owning its own state could not be told about the first.
 *
 * Turning is `wheelPicker.ts` exactly as BubbleWheel uses it, and editing is
 * `usePhoneField` exactly as BubbleInput uses it. Neither is re-implemented here.
 */
export default function BubbleDial({
  options, value, fresh, onChange, font, open, revealed, enabled, hostRef, onSubmit,
}: BubbleDialProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // The comic caret shows only where typing would append — never over a fresh,
  // drum-supplied number, which the next keystroke replaces whole.
  const caretRef = useDialCaret(inputRef, fresh)
  const country = useMemo(() => browserCountry(), [])
  // Anything typed is the reader's own number, however far along it is.
  const field = usePhoneField(inputRef, country, next => onChange(next, false))

  // Revealing the balloon focuses the field, caret at the end, so the panel's only
  // input has the keyboard without a click; hiding the balloon blurs it. What the next
  // keystroke does to the number already lettered is `fresh`'s call (see onKeyDown),
  // not a selection's — a select-all here painted the number in the browser's own
  // highlight ink over the artwork, and the projected keypad never saw it anyway.
  useEffect(() => {
    const input = inputRef.current
    if (!input || !enabled) return
    if (revealed) {
      if (document.activeElement !== input) {
        input.focus({ preventScroll: true })
        const end = input.value.length
        input.setSelectionRange(end, end)
      }
    } else if (document.activeElement === input) {
      input.blur()
    }
  }, [revealed, enabled])

  const [state, setState] = useState<DialState>(() => dialSeat(options, value))
  const matches = useMemo(() => dialMatches(options, state.query), [options, state.query])

  // Both of the corrections below are made during render rather than from an effect, which
  // is React's own guidance for state derived from a changed input and what ComicPanel
  // already does for the seed: an effect would letter the previous row for one frame and
  // then replace it. The re-render is immediate and nothing below has run yet.

  // The value moved without the drum — a keystroke, a projected keypad press, a re-seed —
  // so it is now what the reader means, and the shortlist narrows to it. Compared by
  // dialable digits because a turn reports its row *formatted*, which is a different
  // string from the author's own spelling of the same number.
  const [lastValue, setLastValue] = useState(value)
  if (lastValue !== value) {
    setLastValue(value)
    if (dialDigits(value) !== dialDigits(dialRowValue(state, matches))) setState(dialTyped(value))
  }

  // The shortlist itself changed: the reader dialled a number onto it, or the author
  // edited the options out from under the drum in the inspector. Either way the drum is
  // re-seated on the number the field is showing rather than left on a row that has moved.
  // Keyed on the list's contents, since `options` is rebuilt by the parent every render.
  const optionKey = JSON.stringify(options)
  const [lastOptions, setLastOptions] = useState(optionKey)
  if (lastOptions !== optionKey) {
    setLastOptions(optionKey)
    setState(dialSeat(options, value))
  }

  // One turn, defined once and called from both the wheel and the arrow keys. Kept in a
  // ref and refreshed after every commit so the listener below can be registered per
  // host rather than per render, without ever calling a stale `onChange`.
  const turnRef = useRef<(steps: number) => void>(() => undefined)
  useEffect(() => {
    turnRef.current = (steps: number) => {
      const next = dialTurn(state, matches.length, steps)
      if (next === state) return
      setState(next)
      // A row the turn landed on is the drum's number, so it arrives fresh; row 0 is
      // the reader's own half-typed number handed back, which stays theirs.
      onChange(formatPhoneInput(dialRowValue(next, matches), country), next.index > 0)
    }
  })

  // The wheel gesture (useDialWheel): over the balloon always, and over the whole
  // panel while the reveal has the keyboard — the drum turns wherever the pointer
  // already is, the same reach a keystroke has.
  useDialWheel(hostRef, revealed, enabled && options.length > 0, turnRef)

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation()
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Enter' && onSubmit) {
      event.preventDefault()
      const dialled = value.trim()
      // Kept rather than cleared, unlike a composer: the number stays on the display
      // after it is dialled, the way it does on the phone in the picture. The panel adds
      // it to the shortlist, which comes back down as a new `options` and re-seats us.
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
    // A fresh number — one the drum supplied — is finished: the next character starts a
    // new number, and Backspace clears the display whole, exactly what the projected
    // keypad does with the same flag (ComicPanel). A number the reader typed is theirs
    // and edits normally, one digit at a time.
    if (fresh) {
      if (event.key.length === 1) {
        event.preventDefault()
        field.commit(event.key, 1, true)
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        onChange('', false)
        return
      }
    }
    field.onDeleteKey(event, value)
  }

  const stopPointer = (event: PointerEvent<HTMLInputElement>): void => event.stopPropagation()

  return (
    <div
      className={`cb-panel-bubble-text cb-bubble-wheel cb-bubble-dial${open ? ' is-open' : ''}`}
      style={{ fontFamily: `'${font}', cursive` }}
    >
      {/* The drum. Decorative: every row here is either the field's own (blank, below) or
          a number the drum can be turned to, and the field letters whichever is picked. */}
      <div
        className="cb-wheel-track"
        style={{ transform: `translateY(${wheelOffsetEm(state.index)}em)` }}
        aria-hidden="true"
      >
        {/* Row 0 — what the reader typed, drawn by the field. Blank rather than absent:
            it has to occupy its band or every match above it slides a row too high. */}
        <div className="cb-dial-typed-row" />
        {/* Lettered formatted, the way the field letters whichever one the drum lands
            on; the filter underneath stays on the raw digits (dialMatches). */}
        {matches.map((opt, i) => (
          <div
            key={`${i}:${opt}`}
            className={`cb-wheel-option${i + 1 === state.index ? ' is-selected' : ''}`}
          >
            {formatPhoneInput(opt, country)}
          </div>
        ))}
      </div>
      <input
        ref={inputRef}
        className="cb-bubble-input cb-dial-field"
        style={{ fontFamily: `'${font}', cursive` }}
        // text, not tel, and autocomplete off: Chrome reads `tel` + `autocomplete="tel"`
        // as an invitation to draw its own phone-number dropdown over the drum. The
        // inputMode keeps the numeric keyboard on touch.
        type="text"
        inputMode="tel"
        autoComplete="off"
        aria-label="Phone number"
        disabled={!enabled}
        tabIndex={enabled ? 0 : -1}
        value={value}
        onChange={field.onChange}
        onKeyDown={onKeyDown}
        onPointerDown={stopPointer}
        onClick={event => event.stopPropagation()}
      />
      {/* The comic caret (useDialCaret): ink, not a control, so it takes no pointer. */}
      <span
        ref={caretRef}
        className="cb-dial-caret"
        style={{ visibility: 'hidden' }}
        aria-hidden="true"
      />
    </div>
  )
}
