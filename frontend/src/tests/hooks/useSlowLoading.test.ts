import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSlowReady } from '../../hooks/useSlowLoading'

describe('useSlowReady', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is the identity on its argument while the brake is off', () => {
    const { result, rerender } = renderHook(({ ready }) => useSlowReady(ready, 0), {
      initialProps: { ready: false },
    })
    expect(result.current).toBe(false)

    rerender({ ready: true })
    expect(result.current).toBe(true)
  })

  it('withholds a ready that arrives inside the hold, then reports it', () => {
    const { result, rerender } = renderHook(({ ready }) => useSlowReady(ready, 1000), {
      initialProps: { ready: false },
    })

    // The gate opens almost at once — a cached load — and is held back anyway.
    rerender({ ready: true })
    expect(result.current).toBe(false)

    act(() => { vi.advanceTimersByTime(999) })
    expect(result.current).toBe(false)

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe(true)
  })

  it('does not report ready on the hold alone when the gate is still shut', () => {
    const { result, rerender } = renderHook(({ ready }) => useSlowReady(ready, 1000), {
      initialProps: { ready: false },
    })

    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current).toBe(false)

    rerender({ ready: true })
    expect(result.current).toBe(true)
  })

  it('runs the hold from mount, so a gate that opens after it is not delayed twice', () => {
    const { result, rerender } = renderHook(({ ready }) => useSlowReady(ready, 1000), {
      initialProps: { ready: false },
    })

    act(() => { vi.advanceTimersByTime(1000) })
    rerender({ ready: true })
    expect(result.current).toBe(true)
  })

  it('drops its timer on unmount', () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = renderHook(() => useSlowReady(false, 1000))
    unmount()
    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })
})
