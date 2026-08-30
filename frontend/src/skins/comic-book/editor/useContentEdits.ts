import { useCallback, useMemo } from 'react'

import type { PanelBgStyle } from '../panelPatterns'
import {
  addBubble, addChainColumn as addChainColumnIn, addImg, addPeerPicker, addSmsConversation,
  patchBubble, patchChain, patchImg,
  patchPattern,
  removeBubble, removeImg, resetOneIn, setChained as setChainedIn,
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
   * Make the linked group holding bubble `index` a chain, or take it back to plain
   * balloons. Takes a bubble index rather than a chain id precisely because the id may
   * not exist yet: this is the call that creates one.
   */
  setChained(index: number, on: boolean): void
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
  /**
   * Add a whole SMS conversation to `panel` — both root balloons, linked, chained and
   * bound — and select the sender. One call because the six couplings a conversation is
   * made of are not six decisions the author has any way to get right by hand.
   */
  addSmsOn(panel: number): void
  /** Add the balloon a panel's conversations read their number off, and select it. */
  addPeerPickerOn(panel: number): void
  /** Append the other column of `chain` on `panel` and select it. */
  addChainColumn(panel: number, chain: string): void
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

  const setChained = useCallback(
    (index: number, on: boolean) => apply(prev => setChainedIn(prev, index, on)),
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

  const addSmsOn = useCallback(
    (panel: number) => {
      let added = -1
      apply(prev => {
        const { config: next, index } = addSmsConversation(prev, panel)
        added = index
        return next
      })
      // The *sender* is selected, not the balloon that happens to be last: it is the one
      // the table hangs from, and its inspector carries the conversation's own settings.
      if (added >= 0) setSelected({ kind: 'bubble', index: added })
    },
    [apply, setSelected],
  )

  const addPeerPickerOn = useCallback(
    (panel: number) => {
      let added = -1
      apply(prev => {
        const { config: next, index } = addPeerPicker(prev, panel)
        added = index
        return next
      })
      if (added >= 0) setSelected({ kind: 'bubble', index: added })
    },
    [apply, setSelected],
  )

  const addChainColumn = useCallback(
    (panel: number, chain: string) => {
      let added = -1
      apply(prev => {
        const { config: next, index } = addChainColumnIn(prev, panel, chain)
        added = index
        return next
      })
      // Selected for the same reason a plain add is: the new column lands mirrored across
      // the panel, and the author's next move is to letter it or drag it where it belongs.
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
      setImg, setBubble, setChained, setChain, setPattern, addImgOn, deleteImg,
      addBubbleOn, addSmsOn, addPeerPickerOn, addChainColumn, deleteBubble, resetOne,
    }),
    [
      setImg, setBubble, setChained, setChain, setPattern, addImgOn, deleteImg,
      addBubbleOn, addSmsOn, addPeerPickerOn, addChainColumn, deleteBubble, resetOne,
    ],
  )
}
