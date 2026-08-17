import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntercomGroup } from '../api/client'

const listMock = vi.fn()
const addMock = vi.fn()
const deactivateMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    intercomGroups: {
      list: (...args: unknown[]) => listMock(...args),
      add: (...args: unknown[]) => addMock(...args),
      deactivate: (...args: unknown[]) => deactivateMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useIntercomGroups } from '../hooks/useIntercomGroups'

function makeGroup(over: Partial<IntercomGroup> = {}): IntercomGroup {
  return {
    id: 'ic-1',
    customer_id: 'customer-1',
    number: '600',
    description: 'Floor 1 intercom',
    subscriber_extensions: ['101', '102'],
    bidirectional_audio: true,
    expiry: null,
    active: true,
    created_at: '2026-06-27T10:00:00',
    ...over,
  }
}

describe('useIntercomGroups', () => {
  beforeEach(() => {
    listMock.mockReset()
    addMock.mockReset()
    deactivateMock.mockReset()
  })

  it('loads intercom groups and maps them to rows', async () => {
    listMock.mockResolvedValue({ intercom_groups: [makeGroup()], vs_customer_id: 1 })
    const { result } = renderHook(() => useIntercomGroups())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns.map((c) => c.key)).toEqual([
      'number',
      'description',
      'subscriber_extensions',
      'bidirectional_audio',
      'expiry',
    ])
    const row = result.current.rows[0]
    expect(row['number']).toBe('600')
    expect(row['subscriber_extensions']).toBe('101, 102')
    expect(row['bidirectional_audio']).toBe('Yes')
    expect(row['expiry']).toBe('')
  })

  it('surfaces an error when the request fails', async () => {
    listMock.mockRejectedValue(new Error('500 boom'))
    const { result } = renderHook(() => useIntercomGroups())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load intercom groups')
    expect(result.current.rows).toEqual([])
  })

  it('has a create form and deactivate row action', async () => {
    listMock.mockResolvedValue({ intercom_groups: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useIntercomGroups())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.form).toBeDefined()
    expect(result.current.rowActions).toHaveLength(1)
    expect(result.current.rowActions![0].key).toBe('deactivate')
  })

  it('re-fetches after create', async () => {
    listMock.mockResolvedValue({ intercom_groups: [], vs_customer_id: 1 })
    addMock.mockResolvedValue(makeGroup())
    const { result } = renderHook(() => useIntercomGroups())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.form!.onSubmit({
      number: '601',
      description: '',
      subscriber_extensions: '103',
      bidirectional_audio: 'false',
      expiry: '',
    })
    expect(addMock).toHaveBeenCalledOnce()
    expect(addMock.mock.calls[0][0]).toMatchObject({
      number: '601',
      subscriber_extensions: ['103'],
      bidirectional_audio: false,
      expiry: null,
    })
    expect(listMock).toHaveBeenCalledTimes(2)
  })
})
