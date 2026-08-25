import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { usePlaceholderPage } from '../hooks/usePlaceholderPage'
import { useContacts } from '../hooks/useContacts'
import { useContactGroups } from '../hooks/useContactGroups'
import { useUsers } from '../hooks/useUsers'
import { useSubscriptionLogs } from '../hooks/useSubscriptionLogs'

describe('usePlaceholderPage', () => {
  const config = {
    title: 'Demo',
    description: 'Demo page',
    route: '/demo',
    columns: [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ],
    emptyText: 'Nothing here',
  }

  it('renders structural shape with no rows and no loading', () => {
    const { result } = renderHook(() => usePlaceholderPage(config))
    expect(result.current.loading).toBe(false)
    expect(result.current.rows).toEqual([])
    expect(result.current.columns).toEqual(config.columns)
    expect(result.current.emptyText).toBe('Nothing here')
    expect(result.current.actions.map((a) => a.key)).toEqual(['export'])
    expect(result.current.filters.map((f) => f.key)).toEqual(['search'])
  })

  it('updates the search filter value without producing rows', () => {
    const { result } = renderHook(() => usePlaceholderPage(config))
    act(() => result.current.onFilterChange('search', 'abc'))
    expect(result.current.filters[0].value).toBe('abc')
    expect(result.current.rows).toEqual([])
  })
})

describe('placeholder page hooks', () => {
  it.each([
    [useContacts, 'Contacts', 4],
    [useContactGroups, 'Contact Groups', 3],
    [useUsers, 'Users', 9],
    [useSubscriptionLogs, 'Subscription Logs', 6],
  ] as const)('%o exposes the legacy vendor columns', (hook, title, columnCount) => {
    const { result } = renderHook(() => hook())
    expect(result.current.title).toBe(title)
    expect(result.current.columns).toHaveLength(columnCount)
    expect(result.current.loading).toBe(false)
    expect(result.current.rows).toEqual([])
  })
})
