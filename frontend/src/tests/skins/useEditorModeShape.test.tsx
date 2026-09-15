import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useEditorEngine } from '../../skins/comic-book/editor/useEditorMode'

// The held window shape on the real hook: it starts by following the window, a pick
// holds it, and holding a different grid drops the selection — a vertex index belongs
// to one grid's vertex table and would name a different corner in another's.

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

describe('useEditorEngine shape', () => {
  it('follows the window until a shape is held, and lets go on null', () => {
    const { result } = renderHook(() => useEditorEngine())
    expect(result.current.shape).toBeNull()

    act(() => { result.current.setShape('portrait') })
    expect(result.current.shape).toBe('portrait')

    act(() => { result.current.setShape(null) })
    expect(result.current.shape).toBeNull()
  })

  it('drops the selection when the grid on screen changes, and keeps it otherwise', () => {
    const { result } = renderHook(() => useEditorEngine())
    act(() => { result.current.select('vertex', 3) })
    expect(result.current.selected).toEqual({ kind: 'vertex', index: 3 })

    act(() => { result.current.setShape(null) })
    expect(result.current.selected).toEqual({ kind: 'vertex', index: 3 })

    act(() => { result.current.setShape('square') })
    expect(result.current.selected).toBeNull()
  })
})
