import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroupExtension } from '../api/client'

const listMock = vi.fn()
const addMock = vi.fn()
const deactivateMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    groupExtensions: {
      list: (...args: unknown[]) => listMock(...args),
      add: (...args: unknown[]) => addMock(...args),
      deactivate: (...args: unknown[]) => deactivateMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useGroupExtensions } from '../hooks/useGroupExtensions'

function makeGroup(over: Partial<GroupExtension> = {}): GroupExtension {
  return {
    id: 'ge-1',
    customer_id: 'customer-1',
    description: 'Sales group',
    number: '500',
    subscribed_extensions: ['101', '102'],
    active: true,
    created_at: '2026-06-27T10:00:00',
    ...over,
  }
}

describe('useGroupExtensions', () => {
  beforeEach(() => {
    listMock.mockReset()
    addMock.mockReset()
    deactivateMock.mockReset()
  })

  it('loads group extensions and maps them to rows', async () => {
    listMock.mockResolvedValue({ group_extensions: [makeGroup()], vs_customer_id: 1 })
    const { result } = renderHook(() => useGroupExtensions())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns.map((c) => c.key)).toEqual([
      'description',
      'number',
      'subscribed_extensions',
    ])
    const row = result.current.rows[0]
    expect(row['description']).toBe('Sales group')
    expect(row['number']).toBe('500')
    expect(row['subscribed_extensions']).toBe('101, 102')
  })

  it('surfaces an error when the request fails', async () => {
    listMock.mockRejectedValue(new Error('500 boom'))
    const { result } = renderHook(() => useGroupExtensions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load group extensions')
    expect(result.current.rows).toEqual([])
  })

  it('has a create form and deactivate row action', async () => {
    listMock.mockResolvedValue({ group_extensions: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useGroupExtensions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.form).toBeDefined()
    expect(result.current.rowActions).toHaveLength(1)
    expect(result.current.rowActions![0].key).toBe('deactivate')
  })

  it('splits the comma-separated extensions and re-fetches after create', async () => {
    listMock.mockResolvedValue({ group_extensions: [], vs_customer_id: 1 })
    addMock.mockResolvedValue(makeGroup())
    const { result } = renderHook(() => useGroupExtensions())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.form!.onSubmit({
      description: 'Support',
      number: '501',
      subscribed_extensions: '103, 104,',
    })
    expect(addMock).toHaveBeenCalledOnce()
    expect(addMock.mock.calls[0][0]).toMatchObject({
      number: '501',
      subscribed_extensions: ['103', '104'],
    })
    expect(listMock).toHaveBeenCalledTimes(2)
  })
})
