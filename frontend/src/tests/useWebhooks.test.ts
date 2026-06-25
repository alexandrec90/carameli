import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebhookSubscription } from '../api/client'

const listMock = vi.fn()
const addMock = vi.fn()
const deactivateMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    webhooks: {
      list: (...args: unknown[]) => listMock(...args),
      add: (...args: unknown[]) => addMock(...args),
      deactivate: (...args: unknown[]) => deactivateMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useWebhooks } from '../hooks/useWebhooks'

function makeSub(over: Partial<WebhookSubscription> = {}): WebhookSubscription {
  return {
    id: 'id-1',
    customer_id: 'cust-1',
    description: 'Call ended hook',
    uri: 'https://hooks.example.com/events',
    events: ['call.ended', 'call.started'],
    enabled: true,
    active: true,
    created_at: '2026-06-24T14:31:05',
    ...over,
  }
}

describe('useWebhooks', () => {
  beforeEach(() => {
    listMock.mockReset()
    addMock.mockReset()
    deactivateMock.mockReset()
  })

  it('loads subscriptions and maps them to formatted rows', async () => {
    listMock.mockResolvedValue({ subscriptions: [makeSub()], vs_customer_id: 1 })
    const { result } = renderHook(() => useWebhooks())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns).toHaveLength(4)
    const row = result.current.rows[0]
    expect(row.events).toBe('call.ended, call.started')
    expect(row.enabled).toBe('Yes')
    expect(result.current.filters.map((f) => f.key)).toEqual(['search'])
  })

  it('filters loaded rows client-side via the search box', async () => {
    listMock.mockResolvedValue({
      subscriptions: [
        makeSub({ id: 'a', uri: 'https://hooks.example.com/a' }),
        makeSub({ id: 'b', uri: 'https://other.example.com/b', description: 'Other' }),
      ],
      vs_customer_id: 1,
    })
    const { result } = renderHook(() => useWebhooks())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rows).toHaveLength(2)

    act(() => result.current.onFilterChange('search', 'other.example.com'))

    expect(result.current.rows).toHaveLength(1)
    expect(result.current.rows[0].uri).toBe('https://other.example.com/b')
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces an error and empties rows when the request fails', async () => {
    listMock.mockRejectedValue(new Error('502 boom'))
    const { result } = renderHook(() => useWebhooks())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load webhook subscriptions')
    expect(result.current.rows).toEqual([])
  })

  it('exposes the create form and stashes the row id for deactivation', async () => {
    listMock.mockResolvedValue({ subscriptions: [makeSub({ id: 'sub-7' })], vs_customer_id: 1 })
    const { result } = renderHook(() => useWebhooks())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.form?.fields.map((f) => f.key)).toEqual([
      'description',
      'uri',
      'events',
      'enabled',
    ])
    expect(result.current.rowActions?.[0].key).toBe('deactivate')
    expect(result.current.rowActions?.[0].variant).toBe('danger')
    // id rides on the row record but is not a rendered column.
    expect(result.current.rows[0].id).toBe('sub-7')
    expect(result.current.columns.map((c) => c.key)).not.toContain('id')
  })

  it('submitting the form splits events and calls add, then re-fetches', async () => {
    listMock.mockResolvedValue({ subscriptions: [], vs_customer_id: 1 })
    addMock.mockResolvedValue(makeSub())
    const { result } = renderHook(() => useWebhooks())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(listMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.form!.onSubmit({
        description: 'Hook',
        uri: 'https://hooks.example.com/x',
        events: 'call.ended, call.started ,',
        enabled: 'true',
      })
    })

    expect(addMock).toHaveBeenCalledWith({
      vs_customer_id: 1,
      description: 'Hook',
      uri: 'https://hooks.example.com/x',
      events: ['call.ended', 'call.started'],
      enabled: true,
    })
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('the Deactivate row action calls deactivate with the row id, then re-fetches', async () => {
    listMock.mockResolvedValue({ subscriptions: [makeSub({ id: 'sub-9' })], vs_customer_id: 1 })
    deactivateMock.mockResolvedValue(makeSub({ id: 'sub-9', active: false }))
    const { result } = renderHook(() => useWebhooks())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      result.current.rowActions![0].onClick(result.current.rows[0])
    })

    await waitFor(() => expect(deactivateMock).toHaveBeenCalledWith(1, 'sub-9'))
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces an error when create fails', async () => {
    listMock.mockResolvedValue({ subscriptions: [], vs_customer_id: 1 })
    addMock.mockRejectedValue(new Error('422 bad'))
    const { result } = renderHook(() => useWebhooks())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.form!.onSubmit({ uri: 'ftp://nope', events: '', enabled: 'true' })
    })

    expect(result.current.error).toBe('Failed to create webhook subscription')
  })
})
