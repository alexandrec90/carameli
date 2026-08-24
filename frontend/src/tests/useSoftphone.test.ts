import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Extension, WebphoneCredential } from '../api/client'

const listMock = vi.fn()
const credentialMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    extensions: {
      list: (...args: unknown[]) => listMock(...args),
      webphoneCredential: (...args: unknown[]) => credentialMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

interface FakeDelegate {
  onRegistered?: () => void
  onServerDisconnect?: (e?: Error) => void
  onCallCreated?: (session: unknown) => void
  onCallReceived?: (session: unknown) => void
  onCallAnswered?: () => void
  onCallHangup?: () => void
}

const managers: FakeSessionManager[] = []

class FakeSessionManager {
  connect = vi.fn().mockResolvedValue(undefined)
  register = vi.fn().mockResolvedValue(undefined)
  disconnect = vi.fn().mockResolvedValue(undefined)
  call = vi.fn().mockResolvedValue(undefined)
  answer = vi.fn().mockResolvedValue(undefined)
  decline = vi.fn().mockResolvedValue(undefined)
  hangup = vi.fn().mockResolvedValue(undefined)
  mute = vi.fn()
  unmute = vi.fn()
  sendDTMF = vi.fn().mockResolvedValue(undefined)

  constructor(
    readonly server: string,
    readonly options: { aor?: string; delegate?: FakeDelegate; userAgentOptions?: Record<string, unknown> }
  ) {
    managers.push(this)
  }

  get delegate(): FakeDelegate {
    return this.options.delegate ?? {}
  }
}

vi.mock('sip.js/lib/platform/web', () => ({ SessionManager: FakeSessionManager }))

import { normalizeTarget, useSoftphone } from '../hooks/useSoftphone'

function makeExtension(over: Partial<Extension> = {}): Extension {
  return {
    id: 'ext-1',
    customer_id: 'cust-1',
    extension_number: '101',
    sip_username: 'ext101_abcd1234',
    sip_credential_sid: 'client-1',
    sip_domain_sid: 'sip.test',
    active: true,
    created_at: '2026-08-20T00:00:00',
    ...over,
  }
}

function makeCredential(over: Partial<WebphoneCredential> = {}): WebphoneCredential {
  return {
    extension_number: '101',
    sip_username: 'ext101_abcd1234',
    // Fixture value for a hook test, never a real credential.
    sip_password: 'secret-password', // pragma: allowlist secret
    sip_realm: 'sip.test',
    ws_uri: 'wss://sip.test:8443',
    ...over,
  }
}

const remoteSession = {
  remoteIdentity: { uri: { user: '+14155550123' }, displayName: 'Alice' },
}

/** Render the hook and get past the initial extension load. */
async function readyPhone() {
  const view = renderHook(() => useSoftphone())
  await waitFor(() => {
    expect(view.result.current.selectedId).toBe('ext-1')
  })
  return view
}

/** Register, then let the SBC confirm it the way a real one does. */
async function registered() {
  const view = await readyPhone()
  await act(async () => {
    await view.result.current.connect()
  })
  act(() => {
    managers[0].delegate.onRegistered?.()
  })
  return view
}

describe('useSoftphone', () => {
  beforeEach(() => {
    managers.length = 0
    listMock.mockReset()
    credentialMock.mockReset()
    listMock.mockResolvedValue({ extensions: [makeExtension()] })
    credentialMock.mockResolvedValue(makeCredential())
  })

  it('pre-selects the first extension that has a provisioned SIP client', async () => {
    listMock.mockResolvedValue({
      extensions: [
        makeExtension({ id: 'ext-0', extension_number: '100', sip_credential_sid: null }),
        makeExtension(),
      ],
    })
    const { result } = await readyPhone()
    expect(result.current.extensions).toHaveLength(2)
    expect(result.current.selectedId).toBe('ext-1')
  })

  it('registers against the credential it was issued', async () => {
    const { result } = await registered()

    expect(credentialMock).toHaveBeenCalledWith('ext-1', false)
    expect(managers).toHaveLength(1)
    expect(managers[0].server).toBe('wss://sip.test:8443')
    expect(managers[0].options.aor).toBe('sip:ext101_abcd1234@sip.test')
    expect(managers[0].options.userAgentOptions).toMatchObject({
      authorizationUsername: 'ext101_abcd1234',
      authorizationPassword: 'secret-password', // pragma: allowlist secret
    })
    expect(managers[0].connect).toHaveBeenCalled()
    expect(managers[0].register).toHaveBeenCalled()
    expect(result.current.status).toBe('registered')
    expect(result.current.registeredAs).toBe('ext101_abcd1234@sip.test')
  })

  it('rotates the password on request, which revokes the previous one', async () => {
    const { result } = await readyPhone()
    await act(async () => {
      await result.current.rotateCredential()
    })
    expect(credentialMock).toHaveBeenCalledWith('ext-1', true)
  })

  it('refuses to register when the deployment has no SIP WebSocket URL', async () => {
    credentialMock.mockResolvedValue(makeCredential({ ws_uri: '' }))
    const { result } = await readyPhone()
    await act(async () => {
      await result.current.connect()
    })
    expect(managers).toHaveLength(0)
    expect(result.current.status).toBe('failed')
    expect(result.current.error).toMatch(/SIP WebSocket URL/)
  })

  it('surfaces a refused credential instead of silently staying offline', async () => {
    credentialMock.mockRejectedValue(new Error('409 Extension has no provisioned SIP client'))
    const { result } = await readyPhone()
    await act(async () => {
      await result.current.connect()
    })
    expect(result.current.status).toBe('failed')
    expect(result.current.error).toMatch(/no provisioned SIP client/)
  })

  it('dials a SIP URI on the extension realm', async () => {
    const { result } = await registered()
    act(() => {
      result.current.setDialTarget('(514) 555-0100')
    })
    await act(async () => {
      await result.current.dial()
    })
    expect(managers[0].call).toHaveBeenCalledWith('sip:5145550100@sip.test')
    expect(result.current.callStatus).toBe('dialing')
  })

  it('will not dial before the phone is registered', async () => {
    const { result } = await readyPhone()
    act(() => {
      result.current.setDialTarget('101')
    })
    await act(async () => {
      await result.current.dial()
    })
    expect(managers).toHaveLength(0)
    expect(result.current.error).toMatch(/Register the softphone/)
  })

  it('rings on an inbound call, names the caller, and answers it', async () => {
    const { result } = await registered()

    act(() => {
      managers[0].delegate.onCallReceived?.(remoteSession)
      // The manager reports creation for inbound calls too; it must not
      // relabel a ringing call as outbound.
      managers[0].delegate.onCallCreated?.(remoteSession)
    })
    expect(result.current.callStatus).toBe('ringing')
    expect(result.current.remoteParty).toBe('+14155550123')

    await act(async () => {
      await result.current.answer()
    })
    expect(managers[0].answer).toHaveBeenCalledWith(remoteSession)

    act(() => {
      managers[0].delegate.onCallAnswered?.()
    })
    expect(result.current.callStatus).toBe('active')

    await act(async () => {
      await result.current.hangup()
    })
    expect(managers[0].hangup).toHaveBeenCalledWith(remoteSession)

    act(() => {
      managers[0].delegate.onCallHangup?.()
    })
    expect(result.current.callStatus).toBe('idle')
    expect(result.current.remoteParty).toBe('')
  })

  it('composes a number when idle and sends DTMF mid-call', async () => {
    const { result } = await registered()

    act(() => {
      result.current.pressDigit('4')
      result.current.pressDigit('2')
    })
    expect(result.current.dialTarget).toBe('42')
    expect(managers[0].sendDTMF).not.toHaveBeenCalled()

    act(() => {
      managers[0].delegate.onCallReceived?.(remoteSession)
      managers[0].delegate.onCallAnswered?.()
    })
    act(() => {
      result.current.pressDigit('7')
    })
    expect(managers[0].sendDTMF).toHaveBeenCalledWith(remoteSession, '7')
    expect(result.current.dialTarget).toBe('42')
  })

  it('toggles mute on the live call', async () => {
    const { result } = await registered()
    act(() => {
      managers[0].delegate.onCallReceived?.(remoteSession)
      managers[0].delegate.onCallAnswered?.()
    })

    act(() => {
      result.current.toggleMute()
    })
    expect(managers[0].mute).toHaveBeenCalledWith(remoteSession)
    expect(result.current.muted).toBe(true)

    act(() => {
      result.current.toggleMute()
    })
    expect(managers[0].unmute).toHaveBeenCalledWith(remoteSession)
    expect(result.current.muted).toBe(false)
  })

  it('reports a dropped transport as a failure', async () => {
    const { result } = await registered()
    act(() => {
      managers[0].delegate.onServerDisconnect?.(new Error('socket closed'))
    })
    expect(result.current.status).toBe('failed')
    expect(result.current.error).toMatch(/socket closed/)
  })

  it('unregisters and forgets the session', async () => {
    const { result } = await registered()
    await act(async () => {
      await result.current.disconnect()
    })
    expect(managers[0].disconnect).toHaveBeenCalled()
    expect(result.current.status).toBe('offline')
    expect(result.current.registeredAs).toBe('')
  })
})

describe('normalizeTarget', () => {
  it('keeps only what a SIP request line can dial', () => {
    expect(normalizeTarget('+1 (514) 555-0100')).toBe('+15145550100')
    expect(normalizeTarget('*97')).toBe('*97')
    expect(normalizeTarget('abc')).toBe('')
  })
})
