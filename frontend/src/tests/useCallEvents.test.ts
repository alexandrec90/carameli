import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallEvent } from '../api/client'

const listMock = vi.fn()

vi.mock('../api/client', () => ({
  api: { calls: { list: (...args: unknown[]) => listMock(...args) } },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useCallEvents } from '../hooks/useCallEvents'

function makeEvent(over: Partial<CallEvent> = {}): CallEvent {
  return {
    id: 'id-1',
    call_sid: 'CA1',
    direction: 'inbound',
    from_number: '+14155550000',
    to_number: '+14155550001',
    started_at: '2026-06-24T14:30:00',
    ended_at: '2026-06-24T14:31:00',
    duration_seconds: 65,
    recording_url: 'https://rec.example.com/RE1',
    status: 'completed',
    posted: true,
    created_at: '2026-06-24T14:31:05',
    ...over,
  }
}

describe('useCallEvents', () => {
  beforeEach(() => {
    listMock.mockReset()
  })

  it('loads events and maps them to formatted rows', async () => {
    listMock.mockResolvedValue({ events: [makeEvent()], vs_customer_id: 1 })
    const { result } = renderHook(() => useCallEvents())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns).toHaveLength(7)
    expect(result.current.rows).toHaveLength(1)
    const row = result.current.rows[0]
    expect(row.started_at).toBe('2026-06-24 14:30')
    expect(row.duration).toBe('1:05')
    expect(row.recording).toBe('Yes')
    expect(result.current.filters.map((f) => f.key)).toEqual(['search', 'start', 'end'])
  })

  it('filters loaded rows client-side via the search box (no refetch)', async () => {
    listMock.mockResolvedValue({
      events: [
        makeEvent({ call_sid: 'CA1', to_number: '+14155550001' }),
        makeEvent({ call_sid: 'CA2', to_number: '+19998887777', from_number: '+19998880000' }),
      ],
      vs_customer_id: 1,
    })
    const { result } = renderHook(() => useCallEvents())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rows).toHaveLength(2)

    act(() => result.current.onFilterChange('search', '9998887777'))

    expect(result.current.rows).toHaveLength(1)
    expect(result.current.rows[0].to_number).toBe('+19998887777')
    expect(listMock).toHaveBeenCalledTimes(1) // search did not trigger a new fetch
  })

  it('re-fetches with the date range when a date filter changes', async () => {
    listMock.mockResolvedValue({ events: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useCallEvents())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(listMock).toHaveBeenCalledTimes(1)

    act(() => result.current.onFilterChange('start', '2026-06-01'))

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
    expect(listMock).toHaveBeenLastCalledWith(1, { start: '2026-06-01', end: undefined, limit: 200 })
  })

  it('surfaces an error and empties rows when the request fails', async () => {
    listMock.mockRejectedValue(new Error('502 boom'))
    const { result } = renderHook(() => useCallEvents())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load call events')
    expect(result.current.rows).toEqual([])
  })
})
