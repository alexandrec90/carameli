import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from 'sip.js'
import type { SessionManager } from 'sip.js/lib/platform/web'
import { api } from '../api/client'
import type { Extension } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'

/** Registration state of the browser softphone against the call engine's SBC. */
export type SoftphoneStatus = 'offline' | 'connecting' | 'registered' | 'failed'

/** State of the single call the phone handles at a time. */
export type CallStatus = 'idle' | 'ringing' | 'dialing' | 'active'

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
}

/** Everything a SIP request line accepts: digits, and the three dialable symbols. */
export function normalizeTarget(raw: string): string {
  return raw.replace(/[^0-9*#+]/g, '')
}

function describe(session: Session): string {
  const identity = session.remoteIdentity
  return identity.uri.user || identity.displayName || 'unknown'
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * A SIP softphone in the browser, registered directly against the call engine.
 *
 * Carameli is not the registrar — it issues the credential
 * (`POST /api/v1/extensions/{id}/webphone-credential`) and the phone registers to
 * the SBC over WSS, so media never traverses Carameli or its webhook tunnel. That
 * is the same path a desk phone or Zoiper takes; this hook just removes the step
 * where a human types the credential into a native client.
 *
 * SIP.js is imported dynamically so its ~300 kB stays out of every other page's
 * chunk: nothing loads it until someone registers a phone.
 */
export function useSoftphone(): UseSoftphoneResult {
  const [extensions, setExtensions] = useState<Extension[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState<SoftphoneStatus>('offline')
  const [callStatus, setCallStatus] = useState<CallStatus>('idle')
  const [remoteParty, setRemoteParty] = useState('')
  const [registeredAs, setRegisteredAs] = useState('')
  const [dialTarget, setDialTarget] = useState('')
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const managerRef = useRef<SessionManager | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const realmRef = useRef('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Mirrors callStatus for the callbacks, which are created once and would
  // otherwise close over the value it had at registration time.
  const callStatusRef = useRef<CallStatus>('idle')

  const applyCallStatus = useCallback((next: CallStatus) => {
    callStatusRef.current = next
    setCallStatus(next)
  }, [])

  useEffect(() => {
    api.extensions
      .list(DEMO_VS_CUSTOMER_ID)
      .then((res) => {
        setExtensions(res.extensions)
        const registrable = res.extensions.find((ext) => ext.sip_credential_sid)
        if (registrable) setSelectedId(registrable.id)
      })
      .catch((e) => {
        logger.error('Failed to load extensions for the softphone', { error: String(e) })
        setError('Could not load extensions')
      })
  }, [])

  // Torn down on unmount only: the manager and its audio sink outlive every
  // re-render, so putting them in the dependency list would hang up live calls.
  useEffect(() => {
    return () => {
      managerRef.current?.disconnect().catch(() => undefined)
      managerRef.current = null
      audioRef.current?.remove()
      audioRef.current = null
    }
  }, [])

  function audioSink(): HTMLAudioElement {
    if (!audioRef.current) {
      const el = document.createElement('audio')
      el.autoplay = true
      el.hidden = true
      // Attached rather than free-floating: a detached element is not reliably
      // allowed to play in every browser.
      document.body.appendChild(el)
      audioRef.current = el
    }
    return audioRef.current
  }

  /** Registers the selected extension; resolves true once the phone can place a call. */
  const start = useCallback(
    async (rotate: boolean): Promise<boolean> => {
      const ext = extensions.find((item) => item.id === selectedId)
      if (!ext) {
        setError('Select an extension first')
        return false
      }
      setError('')
      setBusy(true)
      setStatus('connecting')
      try {
        const credential = await api.extensions.webphoneCredential(ext.id, rotate)
        if (!credential.ws_uri) {
          throw new Error('No SIP WebSocket URL is configured for this deployment')
        }

        await managerRef.current?.disconnect().catch(() => undefined)
        const { SessionManager } = await import('sip.js/lib/platform/web')
        const manager = new SessionManager(credential.ws_uri, {
          aor: `sip:${credential.sip_username}@${credential.sip_realm}`,
          media: {
            constraints: { audio: true, video: false },
            remote: { audio: audioSink() },
          },
          userAgentOptions: {
            authorizationUsername: credential.sip_username,
            authorizationPassword: credential.sip_password,
            displayName: credential.extension_number,
          },
          delegate: {
            onRegistered: () => setStatus('registered'),
            onUnregistered: () => setStatus('offline'),
            onServerDisconnect: (e?: Error) => {
              setStatus(e ? 'failed' : 'offline')
              if (e) setError(`Disconnected: ${e.message}`)
            },
            onCallCreated: (session: Session) => {
              sessionRef.current = session
              setRemoteParty(describe(session))
              // Fires for inbound calls too, right after onCallReceived — an
              // already-ringing call must not be relabelled as outbound.
              if (callStatusRef.current !== 'ringing') applyCallStatus('dialing')
            },
            onCallReceived: (session: Session) => {
              sessionRef.current = session
              setRemoteParty(describe(session))
              applyCallStatus('ringing')
            },
            onCallAnswered: () => applyCallStatus('active'),
            onCallHangup: () => {
              sessionRef.current = null
              applyCallStatus('idle')
              setRemoteParty('')
              setMuted(false)
            },
          },
        })
        managerRef.current = manager
        realmRef.current = credential.sip_realm

        await manager.connect()
        await manager.register()
        setRegisteredAs(`${credential.sip_username}@${credential.sip_realm}`)
        // The credential itself is a secret; only the extension identifies the log line.
        logger.info('Softphone registering', {
          extension: credential.extension_number,
          rotated: rotate,
        })
        return true
      } catch (e) {
        setStatus('failed')
        setError(message(e))
        logger.error('Softphone registration failed', { error: String(e) })
        return false
      } finally {
        setBusy(false)
      }
    },
    [applyCallStatus, extensions, selectedId]
  )

  // Wrapped rather than returned directly: `start` reports whether the phone came up,
  // which only the one-touch dial path below has any use for.
  const connect = useCallback(async () => {
    await start(false)
  }, [start])
  const rotateCredential = useCallback(async () => {
    await start(true)
  }, [start])

  const disconnect = useCallback(async () => {
    const manager = managerRef.current
    managerRef.current = null
    sessionRef.current = null
    applyCallStatus('idle')
    setRemoteParty('')
    setRegisteredAs('')
    setStatus('offline')
    if (!manager) return
    try {
      await manager.disconnect()
    } catch (e) {
      logger.warn('Softphone disconnect failed', { error: String(e) })
    }
  }, [applyCallStatus])

  // Reads the manager and realm through their refs, so it is correct immediately after
  // `start` resolves — the state `start` sets is not visible until the next render.
  const placeCall = useCallback(
    async (target: string) => {
      const manager = managerRef.current
      if (!manager) {
        setError('Register the softphone before dialling')
        return
      }
      setError('')
      applyCallStatus('dialing')
      setRemoteParty(target)
      try {
        await manager.call(`sip:${target}@${realmRef.current}`)
      } catch (e) {
        applyCallStatus('idle')
        setRemoteParty('')
        setError(message(e))
      }
    },
    [applyCallStatus]
  )

  const dial = useCallback(async () => {
    if (!managerRef.current || status !== 'registered') {
      setError('Register the softphone before dialling')
      return
    }
    const target = normalizeTarget(dialTarget)
    if (!target) {
      setError('Enter a number to dial')
      return
    }
    await placeCall(target)
  }, [dialTarget, placeCall, status])

  const autoDial = useCallback(
    async (target?: string) => {
      const number = normalizeTarget(target ?? dialTarget)
      if (!number) {
        setError('Enter a number to dial')
        return
      }
      // A number that arrived as an argument was composed somewhere else — a bubble's
      // own field — so adopt it, or the readout would report the previous call.
      if (target !== undefined) setDialTarget(number)
      if (!managerRef.current || status !== 'registered') {
        // `start` has already reported why it could not come up; a second, vaguer
        // message here would replace the useful one.
        if (!(await start(false))) return
      }
      await placeCall(number)
    },
    [dialTarget, placeCall, start, status]
  )

  const answer = useCallback(async () => {
    const manager = managerRef.current
    const session = sessionRef.current
    if (!manager || !session) return
    try {
      await manager.answer(session)
    } catch (e) {
      setError(message(e))
    }
  }, [])

  const decline = useCallback(async () => {
    const manager = managerRef.current
    const session = sessionRef.current
    if (!manager || !session) return
    try {
      await manager.decline(session)
    } catch (e) {
      setError(message(e))
    }
  }, [])

  const hangup = useCallback(async () => {
    const manager = managerRef.current
    const session = sessionRef.current
    if (!manager || !session) return
    try {
      await manager.hangup(session)
    } catch (e) {
      setError(message(e))
    }
  }, [])

  const toggleMute = useCallback(() => {
    const manager = managerRef.current
    const session = sessionRef.current
    if (!manager || !session) return
    setMuted((current) => {
      if (current) manager.unmute(session)
      else manager.mute(session)
      return !current
    })
  }, [])

  const pressDigit = useCallback((digit: string) => {
    const manager = managerRef.current
    const session = sessionRef.current
    // Mid-call a keypress is a tone down the audio path; otherwise it is just
    // another digit of the number being composed.
    if (manager && session && callStatusRef.current === 'active') {
      manager.sendDTMF(session, digit).catch((e) => {
        logger.warn('DTMF failed', { error: String(e) })
      })
      return
    }
    setDialTarget((current) => current + digit)
  }, [])

  return {
    extensions,
    selectedId,
    select: setSelectedId,
    status,
    callStatus,
    remoteParty,
    registeredAs,
    dialTarget,
    setDialTarget,
    muted,
    error,
    busy,
    connect,
    rotateCredential,
    disconnect,
    dial,
    autoDial,
    answer,
    decline,
    hangup,
    toggleMute,
    pressDigit,
  }
}
