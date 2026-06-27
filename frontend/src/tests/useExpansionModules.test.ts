import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExpansionModule } from '../api/client'

const listMock = vi.fn()
const addMock = vi.fn()
const deactivateMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    expansionModules: {
      list: (...args: unknown[]) => listMock(...args),
      add: (...args: unknown[]) => addMock(...args),
      deactivate: (...args: unknown[]) => deactivateMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useExpansionModules } from '../hooks/useExpansionModules'

function makeModule(over: Partial<ExpansionModule> = {}): ExpansionModule {
  return {
    id: 'em-1',
    customer_id: 'cust-1',
    description: 'Reception desk',
    brand: 'Yealink',
    model: 'EXP50',
    active: true,
    created_at: '2026-06-27T10:00:00',
    ...over,
  }
}

describe('useExpansionModules', () => {
  beforeEach(() => {
    listMock.mockReset()
    addMock.mockReset()
    deactivateMock.mockReset()
  })

  it('loads expansion modules and maps them to rows', async () => {
    listMock.mockResolvedValue({ expansion_modules: [makeModule()], vs_customer_id: 1 })
    const { result } = renderHook(() => useExpansionModules())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns.map((c) => c.key)).toEqual(['description', 'brand', 'model'])
    const row = result.current.rows[0]
    expect(row['brand']).toBe('Yealink')
    expect(row['model']).toBe('EXP50')
  })

  it('surfaces an error when the request fails', async () => {
    listMock.mockRejectedValue(new Error('500 boom'))
    const { result } = renderHook(() => useExpansionModules())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load expansion modules')
    expect(result.current.rows).toEqual([])
  })

  it('has a create form and deactivate row action', async () => {
    listMock.mockResolvedValue({ expansion_modules: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useExpansionModules())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.form).toBeDefined()
    expect(result.current.rowActions).toHaveLength(1)
    expect(result.current.rowActions![0].key).toBe('deactivate')
  })

  it('re-fetches after create', async () => {
    listMock.mockResolvedValue({ expansion_modules: [], vs_customer_id: 1 })
    addMock.mockResolvedValue(makeModule())
    const { result } = renderHook(() => useExpansionModules())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.form!.onSubmit({ description: 'D', brand: 'Cisco', model: 'X' })
    expect(addMock).toHaveBeenCalledOnce()
    expect(listMock).toHaveBeenCalledTimes(2)
  })
})
