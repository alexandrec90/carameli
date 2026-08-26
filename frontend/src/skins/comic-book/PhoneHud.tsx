import { useMemo } from 'react'

import type { UseSoftphoneResult } from '../../hooks/useSoftphone'
import { callLabel, canHangup } from '../../lib/softphone'
import { browserCountry, formatPhoneInput } from './phoneInput'
import './phone-hud.css'

interface PhoneHudProps {
  phone: UseSoftphoneResult
}

/**
 * True when the phone has anything to say. The pad itself is part of a photograph, so
 * the handset furniture only appears once someone has used it — the first key press,
 * an incoming call, or a failure worth reading.
 */
export function hudIsVisible(phone: UseSoftphoneResult): boolean {
  return Boolean(phone.dialTarget) || phone.callStatus !== 'idle' || Boolean(phone.error) || phone.busy
}

/**
 * The display and the call keys of the telephone whose number pad is projected onto a
 * picture.
 *
 * A photographed pad has twelve keys and nothing else: no screen, no send button, no
 * receiver to lift. Those live here, in the page's own furniture, rather than as more
 * projected surfaces — a caption box stays legible where a second homography would put
 * the number on a slant, and it cannot be cropped away by the picture's frame polygon.
 */
export default function PhoneHud({ phone }: PhoneHudProps) {
  const {
    dialTarget,
    setDialTarget,
    callStatus,
    remoteParty,
    error,
    busy,
    autoDial,
    answer,
    decline,
    hangup,
    toggleMute,
    muted,
  } = phone

  // The browser's region is only a hint for grouping the digits as they are typed; the
  // number actually dialled is the raw one, which `normalizeTarget` strips back anyway.
  const country = useMemo(() => browserCountry(), [])
  const shown = formatPhoneInput(dialTarget, country)
  const ringing = callStatus === 'ringing'
  const onCall = canHangup(callStatus)

  return (
    <div className="cb-phone-hud" role="region" aria-label="Telephone">
      <div className="cb-phone-hud-readout" aria-live="polite">
        <span className="cb-phone-hud-number">{shown || ' '}</span>
        <span className="cb-phone-hud-state">
          {busy ? 'Picking up the line…' : callLabel(callStatus, remoteParty)}
        </span>
      </div>

      <div className="cb-phone-hud-keys">
        {ringing && (
          <>
            <button type="button" className="cb-button cb-phone-hud-go" onClick={answer}>
              Answer
            </button>
            <button type="button" className="cb-button" onClick={decline}>
              Decline
            </button>
          </>
        )}

        {onCall && (
          <>
            <button type="button" className="cb-button cb-phone-hud-stop" onClick={hangup}>
              Hang up
            </button>
            <button type="button" className="cb-button" onClick={toggleMute}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
          </>
        )}

        {!ringing && !onCall && (
          <>
            <button
              type="button"
              className="cb-button cb-phone-hud-go"
              onClick={autoDial}
              disabled={busy || !dialTarget}
            >
              Call
            </button>
            <button
              type="button"
              className="cb-button"
              aria-label="Delete the last digit"
              onClick={() => setDialTarget(dialTarget.slice(0, -1))}
              disabled={busy || !dialTarget}
            >
              ⌫
            </button>
          </>
        )}
      </div>

      {error && <p className="cb-phone-hud-error">{error}</p>}
    </div>
  )
}
