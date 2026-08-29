import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CallEvent, SmsMessage } from '../api/client'

const callsList = vi.fn()
const smsList = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    calls: { list: (...args: unknown[]) => callsList(...args) },
    sms: { list: (...args: unknown[]) => smsList(...args) },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useLiveTables } from '../hooks/useLiveTables'

function call(over: Partial<CallEvent> = {}): CallEvent {
  return {
    id: 'id-1',
    call_sid: 'CA1',
    direction: 'inbound',
    from_number: '+14155550000',
    to_number: '+14155550001',
    started_at: '2026-08-25T14:30:00',
    ended_at: null,
    duration_seconds: null,
    recording_url: null,
    status: 'ringing',
    posted: false,
    created_at: '2026-08-25T14:30:00',
    ...over,
  }
}

function sms(over: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: 'sms-1',
    direction: 'outbound',
    from_number: '+14155550000',
    to_number: '+14155550001',
    body: 'hi',
    message_sid: 'SM1',
    delivery_status: 'sent',
    error_code: null,
    created_at: '2026-08-25T14:31:00',
    ...over,
  }
}

/** Let the in-flight fetch promises settle without advancing the poll clock. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useLiveTables', () => {
  beforeEach(() => {
    callsList.mockReset()
    smsList.mockReset()
    callsList.mockResolvedValue({ events: [call()], vs_customer_id: 1 })
    smsList.mockResolvedValue({ messages: [sms()], vs_customer_id: 1 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks for nothing when no surface names a feed', async () => {
    const { result } = renderHook(() => useLiveTables([]))
    await settle()
    expect(callsList).not.toHaveBeenCalled()
    expect(smsList).not.toHaveBeenCalled()
    expect(result.current).toEqual({})
  })

  it('loads only the feeds it was asked for', async () => {
    const { result } = renderHook(() => useLiveTables(['calls']))
    await waitFor(() => expect(result.current.calls).toBeDefined())
    expect(result.current.calls).toEqual([
      ['+14155550000', '14:30', '', '/comic-book/call-in-progress.webp'],
    ])
    expect(result.current.sms).toBeUndefined()
    expect(smsList).not.toHaveBeenCalled()
  })

  it('loads both feeds when both are on the page', async () => {
    const { result } = renderHook(() => useLiveTables(['calls', 'sms']))
    await waitFor(() => expect(result.current.sms).toBeDefined())
    expect(result.current.calls).toHaveLength(1)
    expect(result.current.sms?.[0]?.[4]).toBe('hi')
  })

  it('picks up a new record without the page being reloaded', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useLiveTables(['calls'], 1000))
    await waitFor(() => expect(result.current.calls).toHaveLength(1))

    callsList.mockResolvedValue({
      events: [call({ id: 'id-2', status: 'in-progress' }), call()],
      vs_customer_id: 1,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.calls).toHaveLength(2)
    expect(result.current.calls?.[0]?.[3]).toBe('/comic-book/call-in-progress.webp')
  })

  it('hands back the identical array when a poll finds nothing new', async () => {
    // The poll runs whether or not anything happened; a fresh array every interval would
    // repaint every panel on the page for a notepad that says what it already said.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useLiveTables(['calls'], 1000))
    await waitFor(() => expect(result.current.calls).toHaveLength(1))
    const first = result.current

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(callsList).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(first)
  })

  it('keeps the rows already on the surface when a refresh fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useLiveTables(['calls'], 1000))
    await waitFor(() => expect(result.current.calls).toHaveLength(1))

    callsList.mockRejectedValue(new Error('503 upstream'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.calls).toHaveLength(1)
  })

  it('renders an empty feed rather than nothing when the very first load fails', async () => {
    callsList.mockRejectedValue(new Error('503 upstream'))
    const { result } = renderHook(() => useLiveTables(['calls']))
    await waitFor(() => expect(result.current.calls).toEqual([]))
  })

  it('does not poll a hidden tab, and catches up when it comes back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const { result } = renderHook(() => useLiveTables(['calls'], 1000))
    await waitFor(() => expect(result.current.calls).toHaveLength(1))

    hidden.mockReturnValue(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(callsList).toHaveBeenCalledTimes(1)

    hidden.mockReturnValue(false)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(callsList).toHaveBeenCalledTimes(2)
    hidden.mockRestore()
  })

  it('does not restart the poll when the caller rebuilds an equivalent source array', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result, rerender } = renderHook(({ s }: { s: string[] }) =>
      useLiveTables(s as Parameters<typeof useLiveTables>[0], 1000),
    { initialProps: { s: ['calls'] } })
    await waitFor(() => expect(result.current.calls).toHaveLength(1))

    // A new array with the same names, as the editor produces on every keystroke.
    rerender({ s: ['calls'] })
    rerender({ s: ['calls'] })
    await settle()
    expect(callsList).toHaveBeenCalledTimes(1)
  })

  it('stops polling once the surface is gone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result, unmount } = renderHook(() => useLiveTables(['calls'], 1000))
    await waitFor(() => expect(result.current.calls).toHaveLength(1))
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(callsList).toHaveBeenCalledTimes(1)
  })
})
