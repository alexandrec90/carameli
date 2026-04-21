import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({
  api: {
    customers: {
      getPhoneLines: vi.fn(),
    },
    phoneLines: {
      add: vi.fn(),
      deactivate: vi.fn(),
    },
  },
}))

import { api, type PhoneLine } from '../../api/client'
import { usePhoneLines } from '../../hooks/usePhoneLines'

const sampleLine: PhoneLine = {
  id: 'line-1',
  customer_id: 'cust-1',
  phone_number: '+12125550111',
  provider_sid: 'PN123',
  sms_enabled: true,
  recording_enabled: false,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('usePhoneLines', () => {
  it('loading state is true on mount', () => {
    vi.mocked(api.customers.getPhoneLines).mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => usePhoneLines())

    expect(result.current.loading).toBe(true)
    expect(result.current.lines).toEqual([])
  })

  it('populates lines on success', async () => {
    vi.mocked(api.customers.getPhoneLines).mockResolvedValue([sampleLine])

    const { result } = renderHook(() => usePhoneLines())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.lines).toEqual([sampleLine])
  })

  it('sets error on add failure', async () => {
    vi.mocked(api.customers.getPhoneLines).mockResolvedValue([])
    vi.mocked(api.phoneLines.add).mockRejectedValue(new Error('provider unavailable'))

    const { result } = renderHook(() => usePhoneLines())

    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.setAreaCode('212')
    })

    await act(async () => {
      await result.current.addLine()
    })

    expect(api.phoneLines.add).toHaveBeenCalledWith({
      vs_customer_id: 1,
      area_code: '212',
    })
    expect(result.current.error).toContain('provider unavailable')
    expect(result.current.adding).toBe(false)
  })
})
