import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeedDial } from '../api/client'

const listMock = vi.fn()
const addMock = vi.fn()
const deactivateMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    speedDials: {
      list: (...args: unknown[]) => listMock(...args),
      add: (...args: unknown[]) => addMock(...args),
      deactivate: (...args: unknown[]) => deactivateMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useSpeedDials } from '../hooks/useSpeedDials'

function makeDial(over: Partial<SpeedDial> = {}): SpeedDial {
  return {
    id: 'sd-1',
    customer_id: 'cust-1',
    code: '01',
    phone_number: '+15551234567',
    description: 'Main office',
    active: true,
    created_at: '2026-06-27T10:00:00',
    ...over,
  }
}

describe('useSpeedDials', () => {
  beforeEach(() => {
    listMock.mockReset()
    addMock.mockReset()
    deactivateMock.mockReset()
  })

  it('loads speed dials and maps them to rows', async () => {
    listMock.mockResolvedValue({ speed_dials: [makeDial()], vs_customer_id: 1 })
    const { result } = renderHook(() => useSpeedDials())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns.map((c) => c.key)).toEqual([
      'code',
      'phone_number',
      'description',
    ])
    const row = result.current.rows[0]
    expect(row['code']).toBe('01')
    expect(row['phone_number']).toBe('+15551234567')
    expect(row['description']).toBe('Main office')
  })

  it('surfaces an error when the request fails', async () => {
    listMock.mockRejectedValue(new Error('500 boom'))
    const { result } = renderHook(() => useSpeedDials())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load speed dials')
    expect(result.current.rows).toEqual([])
  })

  it('has a create form and deactivate row action', async () => {
    listMock.mockResolvedValue({ speed_dials: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useSpeedDials())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.form).toBeDefined()
    expect(result.current.rowActions).toHaveLength(1)
    expect(result.current.rowActions![0].key).toBe('deactivate')
  })

  it('re-fetches after create', async () => {
    listMock.mockResolvedValue({ speed_dials: [], vs_customer_id: 1 })
    addMock.mockResolvedValue(makeDial())
    const { result } = renderHook(() => useSpeedDials())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.form!.onSubmit({ code: '99', phone_number: '+15559999999', description: '' })
    expect(addMock).toHaveBeenCalledOnce()
    expect(listMock).toHaveBeenCalledTimes(2)
  })
})
