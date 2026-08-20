import type { CallStatus, SoftphoneStatus } from '../hooks/useSoftphone'

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
