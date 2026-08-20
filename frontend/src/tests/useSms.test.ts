import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

import { useSms } from '../hooks/useSms'

function makeMessage(over: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: 'id-1',
    direction: 'outbound',
    from_number: '+14155550000',
    to_number: '+14155550001',
    body: 'hi there',
    message_sid: 'SM1',
    delivery_status: 'delivered',
    error_code: null,
    created_at: '2026-06-24T14:30:00',
    ...over,
  }
}

function makeLine(over: Partial<PhoneLine> = {}): PhoneLine {
  return {
    id: 'line-1',
    customer_id: 'cust-1',
    phone_number: '+14155550000',
    provider_sid: 'prov-1',
    sms_enabled: true,
    recording_enabled: false,
    active: true,
    created_at: '2026-06-01T00:00:00',
    ...over,
  }
}

describe('useSms', () => {
  beforeEach(() => {
    listMock.mockReset()
    sendMock.mockReset()
    phoneLinesMock.mockReset()
    phoneLinesMock.mockResolvedValue([])
  })

  it('loads messages and maps them to formatted rows', async () => {
    listMock.mockResolvedValue({ messages: [makeMessage()], vs_customer_id: 1 })
    const { result } = renderHook(() => useSms())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns).toHaveLength(6)
    expect(result.current.rows).toHaveLength(1)
    const row = result.current.rows[0]
    expect(row.created_at).toBe('2026-06-24 14:30')
    expect(row.direction).toBe('outbound')
    expect(row.body).toBe('hi there')
    expect(row.delivery_status).toBe('delivered')
    expect(result.current.filters.map((f) => f.key)).toEqual(['search', 'start', 'end'])
  })

  it('filters loaded rows client-side via the search box (no refetch)', async () => {
    listMock.mockResolvedValue({
      messages: [
        makeMessage({ message_sid: 'SM1', to_number: '+14155550001' }),
        makeMessage({ message_sid: 'SM2', to_number: '+19998887777', from_number: '+19998880000' }),
      ],
      vs_customer_id: 1,
    })
    const { result } = renderHook(() => useSms())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rows).toHaveLength(2)

    act(() => result.current.onFilterChange('search', '9998887777'))

    expect(result.current.rows).toHaveLength(1)
    expect(result.current.rows[0].to_number).toBe('+19998887777')
    expect(listMock).toHaveBeenCalledTimes(1) // search did not trigger a new fetch
  })

  it('re-fetches with the date range when a date filter changes', async () => {
    listMock.mockResolvedValue({ messages: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useSms())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(listMock).toHaveBeenCalledTimes(1)

    act(() => result.current.onFilterChange('start', '2026-06-01'))

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
    expect(listMock).toHaveBeenLastCalledWith(1, { start: '2026-06-01', end: undefined, limit: 200 })
  })

  it('surfaces an error and empties rows when the request fails', async () => {
    listMock.mockRejectedValue(new Error('502 boom'))
    const { result } = renderHook(() => useSms())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load SMS messages')
    expect(result.current.rows).toEqual([])
  })

  it('pre-fills the sender with the first active SMS-enabled line', async () => {
    listMock.mockResolvedValue({ messages: [], vs_customer_id: 1 })
    phoneLinesMock.mockResolvedValue([
      makeLine({ id: 'l1', phone_number: '+14155550000', sms_enabled: false }),
      makeLine({ id: 'l2', phone_number: '+14155550002', active: false }),
      makeLine({ id: 'l3', phone_number: '+14155550003' }),
    ])
    const { result } = renderHook(() => useSms())

    await waitFor(() =>
      expect(result.current.form?.fields.find((f) => f.key === 'from_number')?.default).toBe(
        '+14155550003',
      ),
    )
    expect(result.current.form?.fields.map((f) => f.key)).toEqual([
      'from_number',
      'to_number',
      'body',
    ])
  })

  it('sends a message and re-loads the list', async () => {
    listMock.mockResolvedValue({ messages: [], vs_customer_id: 1 })
    sendMock.mockResolvedValue({ success: true, message_sid: 'SM9', detail: null })
    const { result } = renderHook(() => useSms())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.form?.onSubmit({
        from_number: ' +14155550000 ',
        to_number: '+14155550001',
        body: 'hello',
      })
    })

    expect(sendMock).toHaveBeenCalledWith(1, {
      from_number: '+14155550000',
      to_number: '+14155550001',
      body: 'hello',
    })
    expect(listMock).toHaveBeenCalledTimes(2) // list refreshed after the send
    expect(result.current.error).toBe('')
  })

  it('rejects a non-+1 destination without calling the API', async () => {
    listMock.mockResolvedValue({ messages: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useSms())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.form?.onSubmit({
        from_number: '+14155550000',
        to_number: '+447700900000',
        body: 'hello',
      })
    })

    expect(sendMock).not.toHaveBeenCalled()
    expect(result.current.error).toBe('Only +1 (US/Canada) destinations are supported')
  })

  it('rejects a blank body without calling the API', async () => {
    listMock.mockResolvedValue({ messages: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useSms())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.form?.onSubmit({
        from_number: '+14155550000',
        to_number: '+14155550001',
        body: '   ',
      })
    })

    expect(sendMock).not.toHaveBeenCalled()
    expect(result.current.error).toBe('From, To and a message body are all required')
  })

  it('surfaces a provider failure from the send call', async () => {
    listMock.mockResolvedValue({ messages: [], vs_customer_id: 1 })
    sendMock.mockRejectedValue(new Error('502 provider error'))
    const { result } = renderHook(() => useSms())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.form?.onSubmit({
        from_number: '+14155550000',
        to_number: '+14155550001',
        body: 'hello',
      })
    })

    expect(result.current.error).toBe('Failed to send SMS')
    expect(listMock).toHaveBeenCalledTimes(1) // no refresh on failure
  })
})
