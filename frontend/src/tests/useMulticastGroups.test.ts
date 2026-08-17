import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MulticastGroup } from '../api/client'

const listMock = vi.fn()
const addMock = vi.fn()
const deactivateMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    multicastGroups: {
      list: (...args: unknown[]) => listMock(...args),
      add: (...args: unknown[]) => addMock(...args),
      deactivate: (...args: unknown[]) => deactivateMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useMulticastGroups } from '../hooks/useMulticastGroups'

function makeGroup(over: Partial<MulticastGroup> = {}): MulticastGroup {
  return {
    id: 'mc-1',
    customer_id: 'customer-1',
    extension: '650',
    description: 'Warehouse broadcast',
    extensions: ['101', '102'],
    users: ['Alex C'],
    active: true,
    created_at: '2026-06-27T10:00:00',
    ...over,
  }
}

describe('useMulticastGroups', () => {
  beforeEach(() => {
    listMock.mockReset()
    addMock.mockReset()
    deactivateMock.mockReset()
  })

  it('loads multicast groups and maps them to rows', async () => {
    listMock.mockResolvedValue({ multicast_groups: [makeGroup()], vs_customer_id: 1 })
    const { result } = renderHook(() => useMulticastGroups())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns.map((c) => c.key)).toEqual([
      'extension',
      'description',
      'extensions',
      'users',
    ])
    const row = result.current.rows[0]
    expect(row['extension']).toBe('650')
    expect(row['extensions']).toBe('101, 102')
    expect(row['users']).toBe('Alex C')
  })

  it('surfaces an error when the request fails', async () => {
    listMock.mockRejectedValue(new Error('500 boom'))
    const { result } = renderHook(() => useMulticastGroups())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load multicast groups')
    expect(result.current.rows).toEqual([])
  })

  it('has a create form and deactivate row action', async () => {
    listMock.mockResolvedValue({ multicast_groups: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useMulticastGroups())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.form).toBeDefined()
    expect(result.current.rowActions).toHaveLength(1)
    expect(result.current.rowActions![0].key).toBe('deactivate')
  })

  it('re-fetches after create', async () => {
    listMock.mockResolvedValue({ multicast_groups: [], vs_customer_id: 1 })
    addMock.mockResolvedValue(makeGroup())
    const { result } = renderHook(() => useMulticastGroups())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.form!.onSubmit({
      extension: '651',
      description: '',
      extensions: '103, 104',
      users: '',
    })
    expect(addMock).toHaveBeenCalledOnce()
    expect(listMock).toHaveBeenCalledTimes(2)
  })
})
