import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePageReady } from '../../skins/comic-book/LoadingOverlay'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('usePageReady', () => {
  it('opens immediately when the page draws no pictures', () => {
    const { result } = renderHook(() => usePageReady(0, 0))
    expect(result.current[0]).toBe(true)
  })

  it('waits for every drawn picture to load or fail', () => {
    const { result } = renderHook(() => usePageReady(2, 0))
    expect(result.current[0]).toBe(false)
    act(() => { result.current[1]() })
    expect(result.current[0]).toBe(false)
    act(() => { result.current[1]() })
    expect(result.current[0]).toBe(true)
  })

  it('holds a cached page until the slow-loading interval ends', () => {
    const { result } = renderHook(() => usePageReady(1, 1000))
    act(() => { result.current[1]() })
    act(() => { vi.advanceTimersByTime(999) })
    expect(result.current[0]).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current[0]).toBe(true)
  })

  it('still waits for pictures after the slow-loading interval ends', () => {
    const { result } = renderHook(() => usePageReady(1, 1000))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current[0]).toBe(false)
    act(() => { result.current[1]() })
    expect(result.current[0]).toBe(true)
  })
})
