import { useMemo } from 'react'

import BubbleKey from './BubbleKey'
import { HANGUP_KEY } from './phoneActions'
import type { PhoneActionHandlers } from './phoneActions'
import { browserCountry, formatPhoneInput } from './phoneInput'
import './bubbleDial.css'

interface BubbleNumberHangupProps {
  /** Who is on the line, as the phone reports it — formatted here, like the dial's field. */
  number: string
  /** Lettering font for the current shape, same as the plain-text span uses. */
  font: string
  /** False in edit mode: the overlay owns the pointer, so the key is drawn and inert. */
  enabled: boolean
  /**
   * What the telephone's keys do on this page (`softphoneActions`). Only the red one is
   * read. Absent in the editor and on a page with no telephone, where the key is drawn
   * and does nothing.
   */
  actions?: PhoneActionHandlers
}

/**
 * The 'number-hangup' content kind: the number on the line, lettered where a `dial-call`
 * balloon letters its field, with the telephone's red key at the right where that balloon
 * has its green one. The same balloon seen from the other end of the call — nothing to
 * type, nothing to turn, one thing to press.
 *
 * Read-only on purpose. The number is whoever is ringing or answered; there is no
 * editing it mid-call, and a field here would claim the panel's keyboard for a value
 * nothing could do anything with. So it is a span, and the balloon states no keyboard
 * claim (`panelKeyboard.ts`).
 *
 * Laid out with the dial's own classes rather than a copy of them, so the two balloons
 * are identical by construction: the field's centre line, the strip the key takes at the
 * right, the key's own size. `has-call` is the dial's name for "a key stands at the
 * right", and it means exactly that here too.
 */
export default function BubbleNumberHangup({
  number, font, enabled, actions,
}: BubbleNumberHangupProps) {
  const country = useMemo(() => browserCountry(), [])
  const hangup = actions?.hangup
  const off = !enabled || !hangup || hangup.disabled

  return (
    <div
      className="cb-panel-bubble-text cb-bubble-wheel cb-bubble-dial has-call cb-bubble-line"
      style={{ fontFamily: `'${font}', cursive` }}
    >
      <span className="cb-dial-field cb-line-number" aria-label="On the line">
        {formatPhoneInput(number, country)}
      </span>
      <BubbleKey
        action={HANGUP_KEY}
        disabled={off}
        className="cb-bubble-call-key"
        onPress={() => hangup?.run()}
      />
    </div>
  )
}
