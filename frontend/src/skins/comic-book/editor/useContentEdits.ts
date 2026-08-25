import { useCallback, useMemo } from 'react'

import type { PanelBgStyle } from '../panelPatterns'
import {
  addBubble, addChainBubble, addImg, patchBubble, patchChain, patchImg, patchPattern,
  removeBubble, removeImg, resetOneIn,
} from './configOps'
import type { SetSelection } from './selection'
import type { BubbleChain, BubbleTransform, EditorConfig, ImgTransform } from './types'

// The mutators for what is *in* the panels — pictures and balloons. Lifted out of
// useEditorMode.ts when the shape editor arrived and the hook stopped fitting in one
// screen; nothing here knows about panel geometry, and nothing in the shape half knows
// about these.

/** Run a pure config operation against the working copy, persisting the result. */
export type ApplyOp = (op: (prev: EditorConfig) => EditorConfig) => void

export interface ContentEdits {
  setImg(index: number, patch: Partial<ImgTransform>): void
  setBubble(index: number, patch: Partial<BubbleTransform>): void
  /**
   * Patch one chain's settings. Keyed by name rather than by index because the chain
   * list is derived from the bubbles — an edit that renames a chain reorders it, and an
   * index captured a render ago would then patch its neighbour.
   */
  setChain(id: string, patch: Partial<BubbleChain>): void
  setPattern(panel: number, style: PanelBgStyle): void
  addImgOn(panel: number): void
  deleteImg(index: number): void
  addBubbleOn(panel: number): void
  /** Append a slot to `chain` on `panel` and select it. */
  addChainSlot(panel: number, chain: string): void
  deleteBubble(index: number): void
  resetOne(kind: 'img' | 'bubble', index: number): void
}

export function useContentEdits(apply: ApplyOp, setSelected: SetSelection): ContentEdits {
  const setImg = useCallback(
    (index: number, patch: Partial<ImgTransform>) => apply(prev => patchImg(prev, index, patch)),
    [apply],
  )

  const setBubble = useCallback(
    (index: number, patch: Partial<BubbleTransform>) =>
      apply(prev => patchBubble(prev, index, patch)),
    [apply],
  )

  const setChain = useCallback(
    (id: string, patch: Partial<BubbleChain>) => apply(prev => patchChain(prev, id, patch)),
    [apply],
  )

  const setPattern = useCallback(
    (panel: number, style: PanelBgStyle) => apply(prev => patchPattern(prev, panel, style)),
    [apply],
  )

  const addImgOn = useCallback(
    (panel: number) => {
      let added = -1
      apply(prev => {
        const { config: next, index } = addImg(prev, panel)
        added = index
        return next
      })
      // The append is to the end, so the index is known without waiting for the state
      // to commit — selecting it here is what puts the new picture in the inspector.
      if (added >= 0) setSelected({ kind: 'img', index: added })
    },
    [apply, setSelected],
  )

  const deleteImg = useCallback(
    (index: number) => {
      apply(prev => removeImg(prev, index))
      // Every later picture shifts down one, so any surviving selection would now point
      // at a different picture than the author was looking at. Drop it.
      setSelected(null)
    },
    [apply, setSelected],
  )

  const addBubbleOn = useCallback(
    (panel: number) => {
      let added = -1
      apply(prev => {
        const { config: next, index } = addBubble(prev, panel)
        added = index
        return next
      })
      // The append is to the end, so the index is known without waiting for the state
      // to commit — selecting it here is what puts the new bubble in the inspector.
      if (added >= 0) setSelected({ kind: 'bubble', index: added })
    },
    [apply, setSelected],
  )

  const addChainSlot = useCallback(
    (panel: number, chain: string) => {
      let added = -1
      apply(prev => {
        const { config: next, index } = addChainBubble(prev, panel, chain)
        added = index
        return next
      })
      // Selected for the same reason a plain add is: the new slot lands offset from the
      // one below it, and the author's next move is to drag it where it belongs.
      if (added >= 0) setSelected({ kind: 'bubble', index: added })
    },
    [apply, setSelected],
  )

  const deleteBubble = useCallback(
    (index: number) => {
      apply(prev => removeBubble(prev, index))
      // Every later bubble shifts down one, so any surviving selection would now point
      // at a different bubble than the author was looking at. Drop it.
      setSelected(null)
    },
    [apply, setSelected],
  )

  const resetOne = useCallback(
    (kind: 'img' | 'bubble', index: number) => apply(prev => resetOneIn(prev, kind, index)),
    [apply],
  )

  return useMemo(
    () => ({
      setImg, setBubble, setChain, setPattern, addImgOn, deleteImg,
      addBubbleOn, addChainSlot, deleteBubble, resetOne,
    }),
    [
      setImg, setBubble, setChain, setPattern, addImgOn, deleteImg,
      addBubbleOn, addChainSlot, deleteBubble, resetOne,
    ],
  )
}
