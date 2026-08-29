import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCallSimulation } from '../hooks/useCallSimulation'
import {
  SIM_EXTENSION,
  SIM_FIRST_LINE_MS,
  SIM_GAP_MIN_MS,
  SIM_RING_MS,
  SIM_SCRIPT,
  speakMs,
} from '../lib/callSimulation'

const NUMBER = '(514) 555-0199'
const DIGITS = '5145550199'

/** Dial, and let the far end pick up. */
function connect(phone: ReturnType<typeof renderHook<ReturnType<typeof useCallSimulation>, void>>) {
  act(() => {
    void phone.result.current.autoDial(NUMBER)
  })
  act(() => {
    vi.advanceTimersByTime(SIM_RING_MS)
  })
}

describe('useCallSimulation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Every silence the shortest one, so the test can step from line to line.
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('is a registered phone with nobody on the line', () => {
    const { result } = renderHook(() => useCallSimulation())
    expect(result.current.status).toBe('registered')
    expect(result.current.registeredAs).toBe(SIM_EXTENSION)
    expect(result.current.callStatus).toBe('idle')
    expect(result.current.transcript).toEqual({ lines: [], speaking: null })
  })

  it('rings the number as dialled, then the far end picks up', () => {
    const { result } = renderHook(() => useCallSimulation())

    act(() => {
      void result.current.autoDial(NUMBER)
    })
    expect(result.current.callStatus).toBe('dialing')
    expect(result.current.remoteParty).toBe(DIGITS)
    expect(result.current.dialTarget).toBe(DIGITS)

    act(() => {
      vi.advanceTimersByTime(SIM_RING_MS - 1)
    })
    expect(result.current.callStatus).toBe('dialing')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.callStatus).toBe('active')
    expect(result.current.transcript.lines).toEqual([])
  })

  it('dials the typed number with no argument, the way the green key does', () => {
    const { result } = renderHook(() => useCallSimulation())
    act(() => {
      result.current.pressDigit('9')
      result.current.pressDigit('1')
      result.current.pressDigit('1')
    })
    act(() => {
      void result.current.dial()
    })
    expect(result.current.callStatus).toBe('dialing')
    expect(result.current.remoteParty).toBe('911')
  })

  it('says the script a line at a time, lighting the speaker for as long as the words last', () => {
    const phone = renderHook(() => useCallSimulation())
    connect(phone)
    const [first, second] = SIM_SCRIPT

    act(() => {
      vi.advanceTimersByTime(SIM_FIRST_LINE_MS)
    })
    let { transcript } = phone.result.current
    expect(transcript.lines.map(l => l.text)).toEqual([first.text])
    expect(transcript.lines[0].speaker).toBe(first.speaker)
    expect(transcript.speaking).toBe(first.speaker)

    act(() => {
      vi.advanceTimersByTime(speakMs(first.text))
    })
    transcript = phone.result.current.transcript
    expect(transcript.speaking).toBeNull()
    expect(transcript.lines).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(SIM_GAP_MIN_MS)
    })
    transcript = phone.result.current.transcript
    expect(transcript.lines.map(l => l.text)).toEqual([first.text, second.text])
    expect(transcript.speaking).toBe(second.speaker)
    // Two lines, two ids: the balloons key their rows on them.
    expect(new Set(transcript.lines.map(l => l.id)).size).toBe(2)
  })

  it('hangs up: idle, nobody on the line, the transcript gone and nothing left to say', () => {
    const phone = renderHook(() => useCallSimulation())
    connect(phone)
    act(() => {
      vi.advanceTimersByTime(SIM_FIRST_LINE_MS)
    })
    expect(phone.result.current.transcript.lines).toHaveLength(1)

    act(() => {
      void phone.result.current.hangup()
    })
    expect(phone.result.current.callStatus).toBe('idle')
    expect(phone.result.current.remoteParty).toBe('')
    expect(phone.result.current.transcript).toEqual({ lines: [], speaking: null })
    expect(vi.getTimerCount()).toBe(0)
    // The number stays in the readout for a redial.
    expect(phone.result.current.dialTarget).toBe(DIGITS)
  })

  it('declines mid-ring the same way', () => {
    const { result } = renderHook(() => useCallSimulation())
    act(() => {
      void result.current.autoDial(NUMBER)
    })
    act(() => {
      void result.current.decline()
    })
    expect(result.current.callStatus).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('places no call for a blank number, and no second call over a first', () => {
    const { result } = renderHook(() => useCallSimulation())
    act(() => {
      void result.current.autoDial('---')
    })
    expect(result.current.callStatus).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)

    act(() => {
      void result.current.autoDial(NUMBER)
    })
    act(() => {
      void result.current.autoDial('18005550100')
    })
    expect(result.current.remoteParty).toBe(DIGITS)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('types digits only while idle — mid-call a key is a tone, and there is nobody to hear it', () => {
    const phone = renderHook(() => useCallSimulation())
    act(() => {
      phone.result.current.pressDigit('4')
    })
    expect(phone.result.current.dialTarget).toBe('4')
    connect(phone)
    act(() => {
      phone.result.current.pressDigit('7')
    })
    expect(phone.result.current.dialTarget).toBe(DIGITS)
  })

  it('toggles mute both ways', () => {
    const { result } = renderHook(() => useCallSimulation())
    act(() => {
      result.current.toggleMute()
    })
    expect(result.current.muted).toBe(true)
    act(() => {
      result.current.toggleMute()
    })
    expect(result.current.muted).toBe(false)
  })

  it('takes its timers with it on unmount', () => {
    const phone = renderHook(() => useCallSimulation())
    connect(phone)
    expect(vi.getTimerCount()).toBe(1)
    phone.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
