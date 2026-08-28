import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSmsSimulation } from '../hooks/useSmsSimulation'
import {
  SIM_REPLIES,
  SIM_SENDER,
  SIM_TYPING_DELAY_MS,
  SIM_TYPING_MS,
} from '../lib/smsSimulation'

// The coin and the pick both come off Math.random, so a test scripts the peer by
// scripting it: the first value decides whether they answer, the second which reply.

const PEER = '+15145550001'
const OTHER = '+15145550002'

/** Queue rng values for the sends a test is about to make. */
const rig = (...values: number[]) => {
  let i = 0
  vi.spyOn(Math, 'random').mockImplementation(() => values[i++] ?? 0.99)
}

describe('useSmsSimulation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows a sent message immediately, as the sender, delivered', () => {
    rig(0.9)
    const { result } = renderHook(() => useSmsSimulation())
    act(() => void result.current.send(PEER, 'hello'))

    const msgs = result.current.conversations[PEER]
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ text: 'hello', outbound: true, status: 'sent' })
    expect(result.current.sender).toBe(SIM_SENDER)
  })

  it('ignores a blank send', () => {
    const { result } = renderHook(() => useSmsSimulation())
    act(() => void result.current.send(PEER, '   '))
    expect(result.current.conversations[PEER]).toBeUndefined()
  })

  it('stays silent forever when the coin says no', () => {
    rig(0.9)
    const { result } = renderHook(() => useSmsSimulation())
    act(() => void result.current.send(PEER, 'anyone there?'))
    act(() => vi.advanceTimersByTime(SIM_TYPING_DELAY_MS + SIM_TYPING_MS + 10_000))

    expect(result.current.conversations[PEER]).toHaveLength(1)
    expect(result.current.typing[PEER]).toBeUndefined()
  })

  it('types for a while, visibly, before the reply lands', () => {
    rig(0.1, 0)
    const { result } = renderHook(() => useSmsSimulation())
    act(() => void result.current.send(PEER, 'hello'))

    // The pause before the dots: they read the message first.
    expect(result.current.typing[PEER]).toBeUndefined()
    act(() => vi.advanceTimersByTime(SIM_TYPING_DELAY_MS))
    expect(result.current.typing[PEER]).toBe(true)
    expect(result.current.conversations[PEER]).toHaveLength(1)

    act(() => vi.advanceTimersByTime(SIM_TYPING_MS))
    expect(result.current.typing[PEER]).toBe(false)
    const msgs = result.current.conversations[PEER]
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toMatchObject({ text: SIM_REPLIES[0], outbound: false, status: 'sent' })
  })

  it('keeps each peer’s conversation while the wheel is elsewhere', () => {
    rig(0.9, 0.9)
    const { result } = renderHook(() => useSmsSimulation())
    act(() => void result.current.send(PEER, 'first thread'))
    act(() => void result.current.send(OTHER, 'second thread'))

    expect(result.current.conversations[PEER][0].text).toBe('first thread')
    expect(result.current.conversations[OTHER][0].text).toBe('second thread')
  })

  it('lands a reply in its own thread even after sending to another peer', () => {
    // First send earns a reply; the second, to another peer, does not.
    rig(0.1, 0, 0.9)
    const { result } = renderHook(() => useSmsSimulation())
    act(() => void result.current.send(PEER, 'hello'))
    act(() => void result.current.send(OTHER, 'unrelated'))
    act(() => vi.advanceTimersByTime(SIM_TYPING_DELAY_MS + SIM_TYPING_MS))

    expect(result.current.conversations[PEER]).toHaveLength(2)
    expect(result.current.conversations[PEER][1].outbound).toBe(false)
    expect(result.current.conversations[OTHER]).toHaveLength(1)
  })

  it('gives every message its own id', () => {
    rig(0.1, 0)
    const { result } = renderHook(() => useSmsSimulation())
    act(() => void result.current.send(PEER, 'hello'))
    act(() => vi.advanceTimersByTime(SIM_TYPING_DELAY_MS + SIM_TYPING_MS))

    const ids = result.current.conversations[PEER].map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cancels a pending reply when the hook unmounts', () => {
    rig(0.1, 0)
    const clear = vi.spyOn(window, 'clearTimeout')
    const { result, unmount } = renderHook(() => useSmsSimulation())
    act(() => void result.current.send(PEER, 'hello'))
    unmount()
    expect(clear).toHaveBeenCalled()
    // Nothing left armed: firing what remains must not touch unmounted state.
    expect(() => vi.runAllTimers()).not.toThrow()
  })
})
