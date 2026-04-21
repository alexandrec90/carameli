import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({
  api: {
    extensions: {
      getAvailable: vi.fn(),
      add: vi.fn(),
    },
  },
}))

import { api, type Extension } from '../../api/client'
import { useExtensions } from '../../hooks/useExtensions'

const createdExtension: Extension = {
  id: 'ext-1',
  customer_id: 'cust-1',
  extension_number: '101',
  sip_username: '101',
  sip_credential_sid: 'CR123',
  sip_domain_sid: 'SD123',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useExtensions', () => {
  it('starts with default loading-like state on mount', () => {
    vi.mocked(api.extensions.getAvailable).mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useExtensions())

    expect(result.current.available).toBeNull()
    expect(result.current.extNumber).toBe('')
    expect(result.current.adding).toBe(false)
    expect(result.current.error).toBe('')
    expect(result.current.success).toBe('')
  })

  it('populates available extensions on success', async () => {
    vi.mocked(api.extensions.getAvailable).mockResolvedValue({
      available: ['100', '101', '102'],
      vs_customer_id: 1,
    })

    const { result } = renderHook(() => useExtensions())

    await waitFor(() => expect(result.current.available).not.toBeNull())
    expect(result.current.available).toEqual({
      available: ['100', '101', '102'],
      vs_customer_id: 1,
    })
  })

  it('sets error when addExtension fails', async () => {
    vi.mocked(api.extensions.getAvailable).mockResolvedValue({
      available: ['100', '101', '102'],
      vs_customer_id: 1,
    })
    vi.mocked(api.extensions.add).mockRejectedValue(new Error('extension failed'))

    const { result } = renderHook(() => useExtensions())

    await waitFor(() => expect(result.current.available).not.toBeNull())

    act(() => {
      result.current.setExtNumber('101')
    })

    await act(async () => {
      await result.current.addExtension()
    })

    expect(api.extensions.add).toHaveBeenCalledWith({
      vs_customer_id: 1,
      extension_number: '101',
    })
    expect(result.current.error).toContain('extension failed')
    expect(result.current.success).toBe('')
    expect(result.current.adding).toBe(false)
  })

  it('adds extension and refreshes availability on success', async () => {
    vi.mocked(api.extensions.getAvailable)
      .mockResolvedValueOnce({
        available: ['101', '102'],
        vs_customer_id: 1,
      })
      .mockResolvedValueOnce({
        available: ['102'],
        vs_customer_id: 1,
      })

    vi.mocked(api.extensions.add).mockResolvedValue(createdExtension)

    const { result } = renderHook(() => useExtensions())

    await waitFor(() => expect(result.current.available?.available).toEqual(['101', '102']))

    act(() => {
      result.current.setExtNumber('101')
    })

    await act(async () => {
      await result.current.addExtension()
    })

    expect(result.current.success).toContain('Extension 101 created')
    expect(result.current.error).toBe('')
    expect(result.current.extNumber).toBe('')
    expect(result.current.available?.available).toEqual(['102'])
  })
})
