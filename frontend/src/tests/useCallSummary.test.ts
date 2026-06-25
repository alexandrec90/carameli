import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallSummaryRow } from '../api/client'

const summaryMock = vi.fn()

vi.mock('../api/client', () => ({
  api: { calls: { summary: (...args: unknown[]) => summaryMock(...args) } },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useCallSummary } from '../hooks/useCallSummary'

function makeRow(over: Partial<CallSummaryRow> = {}): CallSummaryRow {
  return {
    group_key: '101',
    call_count: 2,
    answered_count: 1,
    total_duration_seconds: 90,
    avg_duration_seconds: 45,
    success_rate: 0.5,
    ...over,
  }
}

describe('useCallSummary', () => {
  beforeEach(() => {
    summaryMock.mockReset()
  })

  it('loads summary rows and maps them to formatted cells', async () => {
    summaryMock.mockResolvedValue({ summary: [makeRow()], group_by: 'extension', vs_customer_id: 1 })
    const { result } = renderHook(() => useCallSummary())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns[0].label).toBe('Extension')
    expect(result.current.rows).toHaveLength(1)
    const row = result.current.rows[0]
    expect(row.group_key).toBe('101')
    expect(row.total_duration).toBe('1:30')
    expect(row.avg_duration).toBe('0:45')
    expect(row.success_rate).toBe('50%')
  })

  it('re-fetches grouped by number when the By Number action fires', async () => {
    summaryMock.mockResolvedValue({ summary: [], group_by: 'extension', vs_customer_id: 1 })
    const { result } = renderHook(() => useCallSummary())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(summaryMock).toHaveBeenLastCalledWith(1, {
      groupBy: 'extension',
      start: undefined,
      end: undefined,
    })

    const byNumber = result.current.actions.find((a) => a.key === 'by-number')!
    act(() => byNumber.onClick())

    await waitFor(() => expect(summaryMock).toHaveBeenCalledTimes(2))
    expect(summaryMock).toHaveBeenLastCalledWith(1, {
      groupBy: 'number',
      start: undefined,
      end: undefined,
    })
    expect(result.current.columns[0].label).toBe('Phone Number')
  })

  it('filters loaded rows client-side via the search box (no refetch)', async () => {
    summaryMock.mockResolvedValue({
      summary: [makeRow({ group_key: '101' }), makeRow({ group_key: '202' })],
      group_by: 'extension',
      vs_customer_id: 1,
    })
    const { result } = renderHook(() => useCallSummary())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rows).toHaveLength(2)

    act(() => result.current.onFilterChange('search', '202'))

    expect(result.current.rows).toHaveLength(1)
    expect(result.current.rows[0].group_key).toBe('202')
    expect(summaryMock).toHaveBeenCalledTimes(1)
  })

  it('re-fetches with the date range when a date filter changes', async () => {
    summaryMock.mockResolvedValue({ summary: [], group_by: 'extension', vs_customer_id: 1 })
    const { result } = renderHook(() => useCallSummary())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(summaryMock).toHaveBeenCalledTimes(1)

    act(() => result.current.onFilterChange('start', '2026-06-01'))

    await waitFor(() => expect(summaryMock).toHaveBeenCalledTimes(2))
    expect(summaryMock).toHaveBeenLastCalledWith(1, {
      groupBy: 'extension',
      start: '2026-06-01',
      end: undefined,
    })
  })

  it('surfaces an error and empties rows when the request fails', async () => {
    summaryMock.mockRejectedValue(new Error('502 boom'))
    const { result } = renderHook(() => useCallSummary())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load CDR summary')
    expect(result.current.rows).toEqual([])
  })
})
