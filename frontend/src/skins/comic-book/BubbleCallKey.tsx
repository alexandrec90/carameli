import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { CountryCode } from 'libphonenumber-js/min'

import { CALL_KEY } from './phoneActions'
import { toE164 } from './phoneInput'

interface BubbleCallKeyProps {
  /** The number as the field letters it — the thing the key would dial. */
  value: string
  /** The region a national number is read in, the field's own (see BubbleDial). */
  country?: CountryCode
  /** False in edit mode: the overlay owns the pointer, so the key is drawn and inert. */
  enabled: boolean
  /** Places the call. Absent on a balloon with no telephone behind it. */
  onCall?(value: string): void
}

/**
 * The green key of a `dial-call` balloon: the same drawn telephone key an `actions`
 * balloon letters (`phoneActions.ts`), placed at the right of the dial's own field.
 *
 * **It is greyed until the field holds a number that could be dialled**, which is the one
 * thing it does that Enter in the field does not. Enter is a deliberate act on a number
 * the reader has just finished typing; a key sitting in the balloon is pressable at every
 * moment in between, including the eight keystrokes during which the number is a prefix of
 * somebody else's. So the key answers the question the field cannot be asked to answer —
 * *is this a destination yet?* — and says so in ink rather than by refusing the press,
 * because a control that looks live and does nothing reads as a fault in the drawing.
 *
 * The test is `toE164`, the same one that decides which conversation an SMS chain binds to
 * (`phoneInput.ts`), so a number the panel would text is a number this key will dial. That
 * is `isPossible` rather than `isValid` on purpose: an invented number is still a
 * destination, and the carrier is the one entitled to refuse it.
 *
 * Pressing it and pressing Enter run the same `onSubmit`, so the number joins the drum's
 * redial list either way — a key beside the field is somewhere to press, not a second way
 * to place a call.
 */
export default function BubbleCallKey({
  value, country, enabled, onCall,
}: BubbleCallKeyProps) {
  // Nothing to dial: no number yet, a half-typed one, or an option that is a person's
  // name rather than a number at all.
  const dialable = toE164(value, country) !== null
  const off = !enabled || !dialable || !onCall

  // Every event is stopped here rather than left to bubble: the panel underneath reads a
  // press as "reveal this panel", and a key that also did that would flash the page on
  // every call placed.
  const stopPointer = (event: PointerEvent<HTMLButtonElement>): void => event.stopPropagation()
  const stopKey = (event: KeyboardEvent<HTMLButtonElement>): void => event.stopPropagation()
  const press = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    onCall?.(value)
  }

  return (
    <button
      type="button"
      className="cb-bubble-action cb-bubble-key cb-bubble-call-key"
      aria-label={CALL_KEY.label}
      disabled={off}
      tabIndex={off ? -1 : 0}
      onPointerDown={stopPointer}
      onKeyDown={stopKey}
      onClick={press}
    >
      <img className="cb-bubble-key-art" src={CALL_KEY.src} alt="" />
    </button>
  )
}
