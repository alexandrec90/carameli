import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingLot } from '../api/client'

const listMock = vi.fn()
const addMock = vi.fn()
const deactivateMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    parkingLots: {
      list: (...args: unknown[]) => listMock(...args),
      add: (...args: unknown[]) => addMock(...args),
      deactivate: (...args: unknown[]) => deactivateMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useParkingLots } from '../hooks/useParkingLots'

function makeLot(over: Partial<ParkingLot> = {}): ParkingLot {
  return {
    id: 'pl-1',
    customer_id: 'customer-1',
    description: 'Lobby parking',
    extension: '800',
    ring_back_time_limit: 60,
    active: true,
    created_at: '2026-06-27T10:00:00',
    ...over,
  }
}

describe('useParkingLots', () => {
  beforeEach(() => {
    listMock.mockReset()
    addMock.mockReset()
    deactivateMock.mockReset()
  })

  it('loads parking lots and maps them to rows', async () => {
    listMock.mockResolvedValue({ parking_lots: [makeLot()], vs_customer_id: 1 })
    const { result } = renderHook(() => useParkingLots())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns.map((c) => c.key)).toEqual([
      'description',
      'extension',
      'ring_back_time_limit',
    ])
    const row = result.current.rows[0]
    expect(row['description']).toBe('Lobby parking')
    expect(row['extension']).toBe('800')
    expect(row['ring_back_time_limit']).toBe('60')
  })

  it('surfaces an error when the request fails', async () => {
    listMock.mockRejectedValue(new Error('500 boom'))
    const { result } = renderHook(() => useParkingLots())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load parking lots')
    expect(result.current.rows).toEqual([])
  })

  it('has a create form and deactivate row action', async () => {
    listMock.mockResolvedValue({ parking_lots: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useParkingLots())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.form).toBeDefined()
    expect(result.current.rowActions).toHaveLength(1)
    expect(result.current.rowActions![0].key).toBe('deactivate')
  })

  it('parses the numeric ring-back limit and re-fetches after create', async () => {
    listMock.mockResolvedValue({ parking_lots: [], vs_customer_id: 1 })
    addMock.mockResolvedValue(makeLot())
    const { result } = renderHook(() => useParkingLots())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.form!.onSubmit({
      description: 'Back office',
      extension: '801',
      ring_back_time_limit: '90',
    })
    expect(addMock).toHaveBeenCalledOnce()
    expect(addMock.mock.calls[0][0]).toMatchObject({
      extension: '801',
      ring_back_time_limit: 90,
    })
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('omits the ring-back limit when the field is blank', async () => {
    listMock.mockResolvedValue({ parking_lots: [], vs_customer_id: 1 })
    addMock.mockResolvedValue(makeLot())
    const { result } = renderHook(() => useParkingLots())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.form!.onSubmit({
      description: '',
      extension: '802',
      ring_back_time_limit: '',
    })
    expect(addMock.mock.calls[0][0]).toMatchObject({ ring_back_time_limit: undefined })
  })
})
