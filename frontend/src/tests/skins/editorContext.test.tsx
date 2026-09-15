import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import EditorProvider from '../../skins/comic-book/editor/EditorProvider'
import {
  EditorContext,
  INERT_EDITOR,
  useEditorApi,
  useEditorMode,
} from '../../skins/comic-book/editor/editorContext'
import { SHIPPED_LAYOUT } from '../../skins/comic-book/layoutSource'

// The seam that keeps the editor engine out of a production build.
//
// The size half of this is in `frontend/bundlePolicy.test.ts`, which greps the real
// `dist/` for a string only the engine needs. These are the behaviour half: that a page
// asking for editor state with no engine mounted gets a usable inert answer rather than a
// crash or a null check at every call site, and that mounting the provider still gives the
// overlay everything it had before the split. Both halves are needed — a build with the
// engine stripped out and a page that cannot render without it is not a fix.

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

describe('useEditorMode without an engine', () => {
  it('is switched off, with nothing selected and no shape held', () => {
    const { result } = renderHook(() => useEditorMode())
    expect(result.current.active).toBe(false)
    expect(result.current.selected).toBeNull()
    expect(result.current.shape).toBeNull()
    expect(result.current.callPhase).toBeNull()
  })

  it('draws what the bundle shipped', () => {
    const { result } = renderHook(() => useEditorMode())
    expect(result.current.config).toBe(SHIPPED_LAYOUT)
  })

  // Load-bearing, not tidiness: this object is a dependency of the memos that compute
  // every polygon on the page, so a fresh one per render would recompute all of them
  // every frame. That is why it is a frozen module-scope constant and not a literal.
  it('hands back one shared object, so the page memos hold', () => {
    const { result, rerender } = renderHook(() => useEditorMode())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    expect(result.current).toBe(INERT_EDITOR)
    expect(Object.isFrozen(INERT_EDITOR)).toBe(true)
  })

  it('offers the page no way to reach a mutator', () => {
    const { result } = renderHook(() => useEditorApi())
    expect(result.current).toBeNull()
  })
})

describe('useEditorApi under EditorProvider', () => {
  const wrap = ({ children }: { children: ReactNode }) => <EditorProvider>{children}</EditorProvider>

  it('hands the overlay the engine, mutators and all', () => {
    const { result } = renderHook(() => useEditorApi(), { wrapper: wrap })
    expect(result.current).not.toBeNull()
    expect(typeof result.current?.setPanelLabel).toBe('function')
    expect(typeof result.current?.splitPanel).toBe('function')
    expect(typeof result.current?.addBubbleOn).toBe('function')
  })

  it('gives the page the same engine it gives the overlay, so the two cannot disagree', () => {
    const { result } = renderHook(
      () => ({ view: useEditorMode(), api: useEditorApi() }),
      { wrapper: wrap },
    )
    expect(result.current.view).toBe(result.current.api)
    expect(result.current.view).not.toBe(INERT_EDITOR)
  })
})

describe('a page under an engine that is mounted but switched off', () => {
  // The dev session with no `?edit=1`: the provider is up, so the context is filled, and
  // the page must still read exactly what it reads in a build. Worth its own test because
  // `active` false is the state the editor spends most of its time in, and a regression
  // that only shows when the flag is off is one nobody working on the editor would see.
  it('reads as inactive and draws the shipped config', () => {
    const engine = { ...INERT_EDITOR, setPanelLabel: vi.fn() }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EditorContext.Provider value={engine as never}>{children}</EditorContext.Provider>
    )
    const { result } = renderHook(() => useEditorMode(), { wrapper })
    expect(result.current.active).toBe(false)
    expect(result.current.config).toBe(SHIPPED_LAYOUT)
  })
})
