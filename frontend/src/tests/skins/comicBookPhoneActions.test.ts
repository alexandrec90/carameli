import { describe, expect, it, vi } from 'vitest'

import type { CallStatus, UseSoftphoneResult } from '../../hooks/useSoftphone'
import { EMPTY_TRANSCRIPT } from '../../lib/callTranscript'
import { phoneAction, softphoneActions } from '../../skins/comic-book/phoneActions'

/**
 * A softphone stub with every call verb spied on. Only the four the keys use and the
 * three fields they read matter here; the rest satisfy the contract.
 */
const phoneStub = (over: Partial<UseSoftphoneResult> = {}): UseSoftphoneResult => ({
  extensions: [],
  selectedId: '',
  select: vi.fn(),
  status: 'offline',
  callStatus: 'idle',
  remoteParty: '',
  registeredAs: '',
  dialTarget: '',
  setDialTarget: vi.fn(),
  muted: false,
  error: '',
  busy: false,
  connect: vi.fn(async () => {}),
  rotateCredential: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  dial: vi.fn(async () => {}),
  autoDial: vi.fn(async () => {}),
  answer: vi.fn(async () => {}),
  decline: vi.fn(async () => {}),
  hangup: vi.fn(async () => {}),
  toggleMute: vi.fn(),
  pressDigit: vi.fn(),
  transcript: EMPTY_TRANSCRIPT,
  ...over,
})

describe('phoneAction', () => {
  it('draws the two keys the artwork exists for', () => {
    expect(phoneAction('Call')).toMatchObject({ id: 'call', src: '/comic-book/call-button.webp' })
    expect(phoneAction('End call')).toMatchObject({
      id: 'hangup',
      src: '/comic-book/end-call-button.webp',
    })
  })

  it('matches on letters alone, so an author need not spell a label exactly', () => {
    // The label is authored in the editor's text field. Case, spacing and a hyphen are
    // the three ways the same key gets typed; all three are one entry, not near-misses
    // that silently letter instead of drawing.
    const ids = ['END CALL', 'end-call', 'End  Call'].map(l => phoneAction(l)?.id)
    expect(ids).toEqual(['hangup', 'hangup', 'hangup'])
  })

  it('names no key for a label the telephone does not have', () => {
    expect(phoneAction('Transfer')).toBeNull()
    expect(phoneAction('')).toBeNull()
  })
})

describe('softphoneActions', () => {
  it('dials the typed number with the green key while the phone is idle', () => {
    const phone = phoneStub({ dialTarget: '4388762750' })
    const keys = softphoneActions(phone)

    expect(keys.call?.disabled).toBe(false)
    keys.call?.run()

    expect(phone.autoDial).toHaveBeenCalledTimes(1)
    // No argument: the number is `dialTarget`, which the projected number pad types into.
    expect(phone.autoDial).toHaveBeenCalledWith()
  })

  it('has nothing for the green key to do with no number typed', () => {
    expect(softphoneActions(phoneStub()).call?.disabled).toBe(true)
    expect(softphoneActions(phoneStub({ dialTarget: '911', busy: true })).call?.disabled).toBe(true)
  })

  it('turns the two keys into answer and decline while a call is ringing', () => {
    // The one state where both keys mean something else. A handset has no third and
    // fourth key, so answering has to be the green one.
    const phone = phoneStub({ callStatus: 'ringing', remoteParty: '15145551234' })
    const keys = softphoneActions(phone)

    expect(keys.call?.disabled).toBe(false)
    expect(keys.hangup?.disabled).toBe(false)
    keys.call?.run()
    keys.hangup?.run()

    expect(phone.answer).toHaveBeenCalledTimes(1)
    expect(phone.decline).toHaveBeenCalledTimes(1)
    expect(phone.autoDial).not.toHaveBeenCalled()
    expect(phone.hangup).not.toHaveBeenCalled()
  })

  it('hangs up with the red key once a call is up, and blocks a second dial', () => {
    const live: CallStatus[] = ['dialing', 'active']
    live.forEach(callStatus => {
      const phone = phoneStub({ callStatus, dialTarget: '4388762750' })
      const keys = softphoneActions(phone)

      expect(keys.hangup?.disabled).toBe(false)
      // The number is still in the readout, but dialling it again mid-call is not a
      // thing a telephone does.
      expect(keys.call?.disabled).toBe(true)
      keys.hangup?.run()

      expect(phone.hangup).toHaveBeenCalledTimes(1)
      expect(phone.decline).not.toHaveBeenCalled()
    })
  })

  it('leaves the red key with nothing to do when no call is up', () => {
    expect(softphoneActions(phoneStub()).hangup?.disabled).toBe(true)
  })
})
