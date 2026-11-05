import type { Extension } from '../api/client'
import type { CallTranscript } from './callTranscript'

/** Registration state of the browser softphone against the call engine's SBC. */
export type SoftphoneStatus = 'offline' | 'connecting' | 'registered' | 'failed'

/** State of the single call the phone handles at a time. */
export type CallStatus = 'idle' | 'ringing' | 'dialing' | 'active'

/** The telephone as a view draws it, whichever one `useSoftphone` picked. */
export interface UseSoftphoneResult {
  extensions: Extension[]
  selectedId: string
  select: (id: string) => void
  status: SoftphoneStatus
  callStatus: CallStatus
  /** Who is on the other end — a caller's number inbound, the dialled one outbound. */
  remoteParty: string
  registeredAs: string
  dialTarget: string
  setDialTarget: (value: string) => void
  muted: boolean
  error: string
  busy: boolean
  connect: () => Promise<void>
  /** Re-register on a freshly minted password, which revokes the previous one. */
  rotateCredential: () => Promise<void>
  disconnect: () => Promise<void>
  dial: () => Promise<void>
  /**
   * Dial, registering first when the phone is offline.
   *
   * `dial` refuses on an unregistered phone because its callers put a Register
   * button next to it. A projected number pad has no such chrome — it is a picture
   * of a telephone — so the first key press has to do what lifting a receiver does.
   *
   * `target` is for a caller that holds the number in a field of its own rather than
   * in `dialTarget`, such as a phone-input speech bubble. Passing it also adopts it as
   * `dialTarget`, so the readout agrees with what is ringing.
   */
  autoDial: (target?: string) => Promise<void>
  answer: () => Promise<void>
  decline: () => Promise<void>
  hangup: () => Promise<void>
  toggleMute: () => void
  /** A dialpad press: a DTMF tone mid-call, otherwise another digit to dial. */
  pressDigit: (digit: string) => void
  /**
   * What has been said on the call so far, and who is speaking now. Empty on the live
   * phone: nothing transcribes a real call yet, and this is the seam a transcription
   * will fill (`lib/callTranscript.ts`). The demo fills it with a script.
   */
  transcript: CallTranscript
}

/** Everything a SIP request line accepts: digits, and the three dialable symbols. */
export function normalizeTarget(raw: string): string {
  return raw.replace(/[^0-9*#+]/g, '')
}

/**
 * Presentation-neutral softphone bits every skin needs.
 *
 * Lives here rather than in a skin so the four skins disagree about styling and
 * nothing else: a dialpad with a different key order, or a skin that calls a
 * registered phone "offline", would be a functional difference wearing a
 * presentation costume.
 */
export const DIALPAD_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
]

export function statusLabel(status: SoftphoneStatus): string {
  switch (status) {
    case 'registered':
      return 'Registered'
    case 'connecting':
      return 'Connecting…'
    case 'failed':
      return 'Registration failed'
    default:
      return 'Offline'
  }
}

export function callLabel(callStatus: CallStatus, remoteParty: string): string {
  const who = remoteParty || 'unknown'
  switch (callStatus) {
    case 'ringing':
      return `Incoming call from ${who}`
    case 'dialing':
      return `Calling ${who}…`
    case 'active':
      return `On a call with ${who}`
    default:
      return 'No call in progress'
  }
}

/** True while a call exists that the user can end (as opposed to answer). */
export function canHangup(callStatus: CallStatus): boolean {
  return callStatus === 'dialing' || callStatus === 'active'
}
