import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({
  api: {
    health: vi.fn(),
    customers: {
      get: vi.fn(),
      create: vi.fn(),
      getPhoneLines: vi.fn(),
    },
    phoneLines: {
      getCount: vi.fn(),
      add: vi.fn(),
      deactivate: vi.fn(),
    },
    extensions: {
      getAvailable: vi.fn(),
      add: vi.fn(),
    },
  },
}))

import { api, type Customer, type PhoneLine } from '../../api/client'
import { useDashboard } from '../../hooks/useDashboard'

const demoCustomer: Customer = {
  id: 'cust-1',
  vs_customer_id: 1,
  api_key: 'demo-key',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
}

const demoLines: PhoneLine[] = [
  {
    id: 'line-1',
    customer_id: 'cust-1',
    phone_number: '+12125550111',
    provider_sid: 'PN123',
    sms_enabled: true,
    recording_enabled: false,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useDashboard', () => {
  it('loading state is true on mount', () => {
    vi.mocked(api.health).mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useDashboard())

    expect(result.current.loading).toBe(true)
  })

  it('populates dashboard state on success', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({ ok: true } as Response)
    vi.mocked(api.health).mockResolvedValue({ status: 'ok' })
    vi.mocked(api.customers.get).mockResolvedValue(demoCustomer)
    vi.mocked(api.customers.getPhoneLines).mockResolvedValue(demoLines)
    vi.mocked(api.phoneLines.getCount).mockResolvedValue({
      count: 1,
      vs_customer_id: 1,
    })

    const { result } = renderHook(() => useDashboard())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.apiOnline).toBe(true)
    expect(result.current.customer).toEqual(demoCustomer)
    expect(result.current.phoneLines).toEqual(demoLines)
    expect(result.current.lineCount).toBe(1)
    expect(fetchMock).toHaveBeenCalledWith('/auth/me', {
      credentials: 'include',
    })
  })

  it('sets apiOnline=false when health check fails', async () => {
    vi.mocked(api.health).mockRejectedValue(new Error('backend unreachable'))

    const { result } = renderHook(() => useDashboard())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.apiOnline).toBe(false)
    expect(result.current.customer).toBeNull()
    expect(result.current.phoneLines).toEqual([])
    expect(result.current.lineCount).toBe(0)
  })
})
