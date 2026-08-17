import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conference } from '../api/client'

const listMock = vi.fn()
const addMock = vi.fn()
const deactivateMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    conferences: {
      list: (...args: unknown[]) => listMock(...args),
      add: (...args: unknown[]) => addMock(...args),
      deactivate: (...args: unknown[]) => deactivateMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useConferences } from '../hooks/useConferences'

function makeConference(over: Partial<Conference> = {}): Conference {
  return {
    id: 'cf-1',
    customer_id: 'customer-1',
    number: '700',
    description: 'Weekly all-hands',
    max_participants: 10,
    recorded_calls: true,
    active: true,
    created_at: '2026-06-27T10:00:00',
    ...over,
  }
}

describe('useConferences', () => {
  beforeEach(() => {
    listMock.mockReset()
    addMock.mockReset()
    deactivateMock.mockReset()
  })

  it('loads conferences and maps them to rows', async () => {
    listMock.mockResolvedValue({ conferences: [makeConference()], vs_customer_id: 1 })
    const { result } = renderHook(() => useConferences())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns.map((c) => c.key)).toEqual([
      'number',
      'description',
      'max_participants',
      'recorded_calls',
    ])
    const row = result.current.rows[0]
    expect(row['number']).toBe('700')
    expect(row['max_participants']).toBe('10')
    expect(row['recorded_calls']).toBe('Yes')
  })

  it('surfaces an error when the request fails', async () => {
    listMock.mockRejectedValue(new Error('500 boom'))
    const { result } = renderHook(() => useConferences())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load conferences')
    expect(result.current.rows).toEqual([])
  })

  it('has a create form and deactivate row action', async () => {
    listMock.mockResolvedValue({ conferences: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useConferences())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.form).toBeDefined()
    expect(result.current.rowActions).toHaveLength(1)
    expect(result.current.rowActions![0].key).toBe('deactivate')
  })

  it('parses numeric max participants and re-fetches after create', async () => {
    listMock.mockResolvedValue({ conferences: [], vs_customer_id: 1 })
    addMock.mockResolvedValue(makeConference())
    const { result } = renderHook(() => useConferences())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.form!.onSubmit({
      number: '701',
      description: '',
      max_participants: '25',
      recorded_calls: 'true',
    })
    expect(addMock).toHaveBeenCalledOnce()
    expect(addMock.mock.calls[0][0]).toMatchObject({
      number: '701',
      max_participants: 25,
      recorded_calls: true,
    })
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('omits max participants when the field is blank or not a number', async () => {
    listMock.mockResolvedValue({ conferences: [], vs_customer_id: 1 })
    addMock.mockResolvedValue(makeConference())
    const { result } = renderHook(() => useConferences())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.form!.onSubmit({
      number: '702',
      description: '',
      max_participants: 'lots',
      recorded_calls: 'false',
    })
    expect(addMock.mock.calls[0][0]).toMatchObject({
      max_participants: undefined,
      recorded_calls: false,
    })
  })
})
