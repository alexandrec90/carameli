import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExemptionCode } from '../api/client'

const listMock = vi.fn()
const addMock = vi.fn()
const deactivateMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    exemptionCodes: {
      list: (...args: unknown[]) => listMock(...args),
      add: (...args: unknown[]) => addMock(...args),
      deactivate: (...args: unknown[]) => deactivateMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useExemptionCodes } from '../hooks/useExemptionCodes'

function makeCode(over: Partial<ExemptionCode> = {}): ExemptionCode {
  return {
    id: 'ec-1',
    customer_id: 'cust-1',
    description: 'Long distance override',
    code: 'EXEMPT01',
    call_restrictions: 'international',
    active: true,
    created_at: '2026-06-27T10:00:00',
    ...over,
  }
}

describe('useExemptionCodes', () => {
  beforeEach(() => {
    listMock.mockReset()
    addMock.mockReset()
    deactivateMock.mockReset()
  })

  it('loads exemption codes and maps them to rows', async () => {
    listMock.mockResolvedValue({ exemption_codes: [makeCode()], vs_customer_id: 1 })
    const { result } = renderHook(() => useExemptionCodes())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns.map((c) => c.key)).toEqual([
      'description',
      'code',
      'call_restrictions',
    ])
    const row = result.current.rows[0]
    expect(row['code']).toBe('EXEMPT01')
    expect(row['call_restrictions']).toBe('international')
  })

  it('surfaces an error when the request fails', async () => {
    listMock.mockRejectedValue(new Error('500 boom'))
    const { result } = renderHook(() => useExemptionCodes())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load exemption codes')
    expect(result.current.rows).toEqual([])
  })

  it('has a create form and deactivate row action', async () => {
    listMock.mockResolvedValue({ exemption_codes: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useExemptionCodes())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.form).toBeDefined()
    expect(result.current.rowActions).toHaveLength(1)
    expect(result.current.rowActions![0].key).toBe('deactivate')
  })

  it('re-fetches after create', async () => {
    listMock.mockResolvedValue({ exemption_codes: [], vs_customer_id: 1 })
    addMock.mockResolvedValue(makeCode())
    const { result } = renderHook(() => useExemptionCodes())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.form!.onSubmit({ description: 'D', code: 'C1', call_restrictions: '' })
    expect(addMock).toHaveBeenCalledOnce()
    expect(listMock).toHaveBeenCalledTimes(2)
  })
})
