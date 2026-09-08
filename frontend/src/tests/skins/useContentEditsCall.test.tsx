import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { addCallScene } from '../../skins/comic-book/editor/callSceneCreate'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import type { EditorConfig } from '../../skins/comic-book/editor/types'
import { useContentEdits } from '../../skins/comic-book/editor/useContentEdits'
import type { ApplyOp } from '../../skins/comic-book/editor/useContentEdits'
import type { CallScenePhase } from '../../skins/comic-book/phoneActions'

// The bug this file holds against: with the call layout switched to Ringing or Connected,
// "+ Bubble" and "+ Image" added to the panel's *default* layout — off screen. The pure
// ops take the phase (editorConfigOps.test.ts); this is the hook handing them the switch's
// position, which is the half a test of the ops cannot see.

const CALL_PANEL = 4

/** The entry an add appended — always the last one. */
const last = <T,>(list: T[]): T => list[list.length - 1]

/** Runs each op against a config it holds, the way the working copy does. */
function harness(phase: CallScenePhase | null) {
  let config: EditorConfig = addCallScene(seedConfig(), CALL_PANEL).config
  const apply: ApplyOp = op => {
    config = op(config)
  }
  const setSelected = vi.fn()
  const { result } = renderHook(() => useContentEdits(apply, setSelected, phase))
  return { api: result.current, current: () => config, setSelected }
}

describe('adding while a call layout is on screen', () => {
  it('puts a new bubble in the layout being looked at, and selects it', () => {
    const { api, current, setSelected } = harness('ringing')
    act(() => api.addBubbleOn(CALL_PANEL))
    const added = last(current().bubbles)
    expect(added.panel).toBe(CALL_PANEL)
    expect(added.call).toBe('ringing')
    expect(setSelected).toHaveBeenCalledWith({
      kind: 'bubble', index: current().bubbles.length - 1,
    })
  })

  it('puts a new picture in the layout being looked at', () => {
    const { api, current } = harness('connected')
    act(() => api.addImgOn(CALL_PANEL))
    expect(last(current().images).call).toBe('remote')
  })

  it('adds to the default layout while that is what is on screen', () => {
    const { api, current } = harness(null)
    act(() => api.addBubbleOn(CALL_PANEL))
    act(() => api.addImgOn(CALL_PANEL))
    expect('call' in last(current().bubbles)).toBe(false)
    expect('call' in last(current().images)).toBe(false)
  })
})
