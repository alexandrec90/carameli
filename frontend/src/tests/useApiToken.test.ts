import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiTokenRow } from '../api/client'

const listMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    apiTokens: {
      list: (...args: unknown[]) => listMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useApiToken } from '../hooks/useApiToken'

function makeToken(over: Partial<ApiTokenRow> = {}): ApiTokenRow {
  return {
    token_masked: 'abcd****5678',
    enabled: true,
    ...over,
  }
}

describe('useApiToken', () => {
  // The block body is load-bearing: `beforeEach(() => listMock.mockReset())` implicitly
  // returns the mock (mockReset() is chainable), and vitest calls a function returned
  // from beforeEach as an after-test cleanup hook — so the rejection-test's mock gets
  // invoked post-test and its rejected value fails the test.
  beforeEach(() => {
    listMock.mockReset()
  })

  it('loads token and maps it to a row', async () => {
    listMock.mockResolvedValue({ tokens: [makeToken()], vs_customer_id: 1 })
    const { result } = renderHook(() => useApiToken())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns.map((c) => c.key)).toEqual(['token_masked', 'enabled'])
    const row = result.current.rows[0]
    expect(row['token_masked']).toBe('abcd****5678')
    expect(row['enabled']).toBe('Yes')
  })

  it('surfaces an error when the request fails', async () => {
    listMock.mockRejectedValue(new Error('500 boom'))
    const { result } = renderHook(() => useApiToken())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load API tokens')
    expect(result.current.rows).toEqual([])
  })

  it('is read-only: no form and no row actions', async () => {
    listMock.mockResolvedValue({ tokens: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useApiToken())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.form).toBeUndefined()
    expect(result.current.rowActions).toBeUndefined()
  })

  it('renders disabled token as Enabled=No', async () => {
    listMock.mockResolvedValue({
      tokens: [makeToken({ enabled: false })],
      vs_customer_id: 1,
    })
    const { result } = renderHook(() => useApiToken())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rows[0]['enabled']).toBe('No')
  })
})
