import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useDemoTables } from '../hooks/useDemoTables'
import { LIVE_TABLE_LIMIT } from '../lib/liveTables'
import type { TableSource } from '../lib/liveTables'

describe('useDemoTables', () => {
  it('answers with nothing for a page that has no live surface', () => {
    const { result } = renderHook(() => useDemoTables([]))
    expect(result.current).toEqual({})
  })

  it('supplies only the feeds it was asked for', () => {
    const { result } = renderHook(() => useDemoTables(['calls']))
    expect(Object.keys(result.current)).toEqual(['calls'])
  })

  it('fills every surface on the page with a full table', () => {
    const { result } = renderHook(() => useDemoTables(['calls', 'sms']))
    expect(result.current.calls).toHaveLength(LIVE_TABLE_LIMIT)
    expect(result.current.sms).toHaveLength(LIVE_TABLE_LIMIT)
  })

  it('hands back the identical object across renders, so nothing repaints', () => {
    const { result, rerender } = renderHook(() => useDemoTables(['calls']))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('keeps that identity when the caller rebuilds an equivalent source array', () => {
    const { result, rerender } = renderHook(
      ({ sources }: { sources: TableSource[] }) => useDemoTables(sources),
      { initialProps: { sources: ['calls', 'sms'] } },
    )
    const first = result.current
    rerender({ sources: ['sms', 'calls', 'sms'] })
    expect(result.current).toBe(first)
  })

  it('drops the last page rows when a page has no surface', () => {
    const { result, rerender } = renderHook(
      ({ sources }: { sources: TableSource[] }) => useDemoTables(sources),
      { initialProps: { sources: ['calls'] } },
    )
    rerender({ sources: [] })
    expect(result.current).toEqual({})
  })
})
