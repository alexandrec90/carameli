import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SmsMessage } from '../api/client'

const listMock = vi.fn()

vi.mock('../api/client', () => ({
  api: { sms: { list: (...args: unknown[]) => listMock(...args) } },
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

describe('useSms', () => {
  beforeEach(() => {
    listMock.mockReset()
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
})
