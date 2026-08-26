import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PhoneLine, SmsMessage } from '../api/client'

const listMock = vi.fn()
const sendMock = vi.fn()
const phoneLinesMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    sms: {
      list: (...args: unknown[]) => listMock(...args),
      send: (...args: unknown[]) => sendMock(...args),
    },
    customers: { getPhoneLines: (...args: unknown[]) => phoneLinesMock(...args) },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { SMS_POLL_MS, useSmsConversations } from '../hooks/useSmsConversations'

const PEER = '+14155551111'
const MINE = '+14155550000'

function message(over: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: 'id-1',
    direction: 'inbound',
    from_number: PEER,
    to_number: MINE,
    body: 'hello',
    message_sid: 'SM1',
    delivery_status: 'delivered',
    error_code: null,
    created_at: '2026-08-26T12:00:00Z',
    ...over,
  }
}

function smsLine(): PhoneLine {
  return {
    id: 'line-1',
    customer_id: 'cust-1',
    phone_number: MINE,
    provider_sid: 'prov-1',
    sms_enabled: true,
    recording_enabled: false,
    active: true,
    created_at: '2026-08-01T00:00:00Z',
  }
}

describe('useSmsConversations', () => {
  beforeEach(() => {
    listMock.mockReset()
    sendMock.mockReset()
    phoneLinesMock.mockReset()
    listMock.mockResolvedValue({ messages: [] })
    sendMock.mockResolvedValue({ success: true })
    phoneLinesMock.mockResolvedValue([smsLine()])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('makes no requests at all until something subscribes', async () => {
    renderHook(() => useSmsConversations())
    await Promise.resolve()
    expect(listMock).not.toHaveBeenCalled()
    // The reason App can mount this for every skin: three of the four show no threads.
    expect(phoneLinesMock).not.toHaveBeenCalled()
  })

  it('fetches the subscribed conversation, scoped by peer', async () => {
    listMock.mockResolvedValue({ messages: [message()] })
    const { result } = renderHook(() => useSmsConversations())

    act(() => {
      result.current.subscribe(PEER)
    })

    await waitFor(() => expect(result.current.conversations[PEER]).toHaveLength(1))
    expect(listMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ peer: PEER }))
    expect(result.current.conversations[PEER][0].text).toBe('hello')
    expect(result.current.conversations[PEER][0].outbound).toBe(false)
  })

  it('shares one poll between two subscribers and stops when the last leaves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useSmsConversations())

    let dropA = () => undefined as void
    let dropB = () => undefined as void
    act(() => {
      dropA = result.current.subscribe(PEER)
      dropB = result.current.subscribe(PEER)
    })
    await waitFor(() => expect(listMock).toHaveBeenCalled())

    const afterMount = listMock.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(SMS_POLL_MS)
    })
    // One tick, one request — not one per subscriber.
    await waitFor(() => expect(listMock.mock.calls.length).toBe(afterMount + 1))

    act(() => {
      dropA()
    })
    const afterOneLeft = listMock.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(SMS_POLL_MS)
    })
    await waitFor(() => expect(listMock.mock.calls.length).toBe(afterOneLeft + 1))

    act(() => {
      dropB()
    })
    const afterAllLeft = listMock.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(SMS_POLL_MS * 3)
    })
    expect(listMock.mock.calls.length).toBe(afterAllLeft)
  })

  it('shows a sent message before the carrier has confirmed it', async () => {
    const { result } = renderHook(() => useSmsConversations())
    act(() => {
      result.current.subscribe(PEER)
    })
    await waitFor(() => expect(result.current.sender).toBe(MINE))

    // The list stays empty, so the only thing that can put the message on screen is the
    // optimistic row.
    await act(async () => {
      await result.current.send(PEER, 'on its way')
    })

    expect(sendMock).toHaveBeenCalledWith(
      expect.anything(),
      { from_number: MINE, to_number: PEER, body: 'on its way' },
    )
    const thread = result.current.conversations[PEER]
    expect(thread.map(m => m.text)).toEqual(['on its way'])
    expect(thread[0].outbound).toBe(true)
    expect(thread[0].status).toBe('sending')
  })

  it('marks the message failed and reports the error when the send throws', async () => {
    sendMock.mockRejectedValue(new Error('carrier down'))
    const { result } = renderHook(() => useSmsConversations())
    act(() => {
      result.current.subscribe(PEER)
    })
    await waitFor(() => expect(result.current.sender).toBe(MINE))

    await act(async () => {
      await result.current.send(PEER, 'nope')
    })

    expect(result.current.conversations[PEER][0].status).toBe('failed')
    expect(result.current.error).not.toBe('')
  })

  it('refuses to send with no SMS-enabled number configured', async () => {
    phoneLinesMock.mockResolvedValue([])
    const { result } = renderHook(() => useSmsConversations())
    act(() => {
      result.current.subscribe(PEER)
    })
    await waitFor(() => expect(phoneLinesMock).toHaveBeenCalled())

    await act(async () => {
      await result.current.send(PEER, 'hi')
    })

    expect(sendMock).not.toHaveBeenCalled()
    expect(result.current.error).not.toBe('')
  })

  it('refuses a destination the backend would reject anyway', async () => {
    const { result } = renderHook(() => useSmsConversations())
    act(() => {
      result.current.subscribe('+442071838750')
    })
    await waitFor(() => expect(result.current.sender).toBe(MINE))

    await act(async () => {
      await result.current.send('+442071838750', 'hi')
    })

    expect(sendMock).not.toHaveBeenCalled()
    expect(result.current.error).not.toBe('')
  })

  it('ignores an empty composer', async () => {
    const { result } = renderHook(() => useSmsConversations())
    act(() => {
      result.current.subscribe(PEER)
    })
    await waitFor(() => expect(result.current.sender).toBe(MINE))

    await act(async () => {
      await result.current.send(PEER, '   ')
    })

    expect(sendMock).not.toHaveBeenCalled()
  })

  it('keeps the transcript’s identity when a poll changes nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    listMock.mockResolvedValue({ messages: [message()] })
    const { result } = renderHook(() => useSmsConversations())
    act(() => {
      result.current.subscribe(PEER)
    })
    await waitFor(() => expect(result.current.conversations[PEER]).toBeDefined())

    const first = result.current.conversations[PEER]
    await act(async () => {
      vi.advanceTimersByTime(SMS_POLL_MS)
    })
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThan(1))

    // Same array, so a panel drawing this conversation does not re-render every 5s.
    expect(result.current.conversations[PEER]).toBe(first)
  })

  it('reports a failed poll without discarding the conversation', async () => {
    // Fake timers before the render: the interval has to be created under them, or
    // advancing the clock later moves a clock the hook is not on.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    listMock.mockResolvedValueOnce({ messages: [message()] })
    const { result } = renderHook(() => useSmsConversations())
    act(() => {
      result.current.subscribe(PEER)
    })
    await waitFor(() => expect(result.current.conversations[PEER]).toHaveLength(1))

    listMock.mockRejectedValue(new Error('offline'))
    await act(async () => {
      vi.advanceTimersByTime(SMS_POLL_MS)
    })

    await waitFor(() => expect(result.current.error).not.toBe(''))
    // A dropped connection is not an empty thread: what was on screen stays there.
    expect(result.current.conversations[PEER]).toHaveLength(1)
  })
})
