import { useCallback, useEffect, useRef, useState } from 'react'

import {
  SIM_EXTENSION,
  SIM_FIRST_LINE_MS,
  SIM_RING_MS,
  simGapMs,
  simLineAt,
  speakMs,
} from '../lib/callSimulation'
import { EMPTY_TRANSCRIPT } from '../lib/callTranscript'
import type { CallTranscript, CallTranscriptLine } from '../lib/callTranscript'
import { normalizeTarget } from './useSoftphone'
import type { CallStatus, UseSoftphoneResult } from './useSoftphone'

const settled = (): Promise<void> => Promise.resolve()
const noop = (): void => undefined

/**
 * A stand-in for `useSoftphone` that rings nobody, for looking at the call UI without a
 * carrier bill. Dev-only, switched on with `?callSim=1` (see `lib/callSimulation.ts`);
 * App picks it instead of the shared softphone behind an `import.meta.env.DEV` test, so
 * a production build does not carry it.
 *
 * Same contract, so the skin cannot tell. What is different is where the call goes:
 * `dial` rings for {@link SIM_RING_MS}, the far end picks up, and the two parties then
 * say `SIM_SCRIPT` a line at a time — each line lands in `transcript` with its speaker
 * marked as talking for as long as the words last, then a silence of random length, then
 * the next. `hangup` (or `decline`) drops the call, clears the transcript and cancels
 * whatever was about to be said. The phone reports itself registered throughout, as
 * `SIM_EXTENSION`, so nothing asks it to connect first.
 */
export function useCallSimulation(): UseSoftphoneResult {
  const [callStatus, setCallStatus] = useState<CallStatus>('idle')
  const [dialTarget, setDialTarget] = useState('')
  const [remoteParty, setRemoteParty] = useState('')
  const [muted, setMuted] = useState(false)
  const [transcript, setTranscript] = useState<CallTranscript>(EMPTY_TRANSCRIPT)
  // Line ids: unique is all they need to be, and a counter says which line was which.
  const seqRef = useRef(0)
  const timersRef = useRef(new Set<number>())

  const clearTimers = useCallback((): void => {
    for (const t of timersRef.current) window.clearTimeout(t)
    timersRef.current.clear()
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  const later = useCallback((ms: number, run: () => void): void => {
    const t = window.setTimeout(() => {
      timersRef.current.delete(t)
      run()
    }, ms)
    timersRef.current.add(t)
  }, [])

  // Say line `index` after a silence, hold the speaker lit while it lasts, then the next.
  const speakFrom = useCallback(
    function speak(index: number): void {
      const line = simLineAt(index, Math.random)
      if (line === null) return
      later(index === 0 ? SIM_FIRST_LINE_MS : simGapMs(Math.random), () => {
        seqRef.current += 1
        const said: CallTranscriptLine = { id: `sim:${seqRef.current}`, ...line }
        setTranscript(prev => ({ lines: [...prev.lines, said], speaking: line.speaker }))
        later(speakMs(line.text), () => {
          setTranscript(prev => ({ ...prev, speaking: null }))
          speak(index + 1)
        })
      })
    },
    [later],
  )

  const endCall = useCallback((): Promise<void> => {
    clearTimers()
    setCallStatus('idle')
    setRemoteParty('')
    setTranscript(EMPTY_TRANSCRIPT)
    return settled()
  }, [clearTimers])

  // One call at a time, like the phone it stands in for: a second dial while one is up
  // is ignored, the way `softphoneActions` disables the green key for it.
  const startCall = useCallback(
    (target: string): Promise<void> => {
      const number = normalizeTarget(target)
      if (number === '' || callStatus !== 'idle') return settled()
      setDialTarget(number)
      setRemoteParty(number)
      setTranscript(EMPTY_TRANSCRIPT)
      setCallStatus('dialing')
      later(SIM_RING_MS, () => {
        setCallStatus('active')
        speakFrom(0)
      })
      return settled()
    },
    [callStatus, later, speakFrom],
  )

  const dial = useCallback(() => startCall(dialTarget), [dialTarget, startCall])
  const autoDial = useCallback(
    (target?: string) => startCall(target ?? dialTarget),
    [dialTarget, startCall],
  )

  // A key press types another digit; mid-call the real phone sends a tone, and the
  // simulation has nobody to send one to.
  const pressDigit = useCallback(
    (digit: string): void => {
      if (callStatus === 'idle') setDialTarget(current => current + digit)
    },
    [callStatus],
  )

  const toggleMute = useCallback((): void => setMuted(m => !m), [])

  return {
    extensions: [],
    selectedId: '',
    select: noop,
    status: 'registered',
    callStatus,
    remoteParty,
    registeredAs: SIM_EXTENSION,
    dialTarget,
    setDialTarget,
    muted,
    error: '',
    busy: false,
    connect: settled,
    rotateCredential: settled,
    disconnect: settled,
    dial,
    autoDial,
    answer: settled,
    decline: endCall,
    hangup: endCall,
    toggleMute,
    pressDigit,
    transcript,
  }
}
