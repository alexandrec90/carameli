import { useCallback, useMemo, useState } from 'react'

import type { CallScenePhase } from '../phoneActions'
import { addCallScene, patchCallScene } from './configOps'
import type { SetSelection } from './selection'
import type { ApplyOp } from './useContentEdits'
import type { CallSceneLayout } from './types'

// The half of the editor that is about phone calls: which layout is being looked at, and
// the two edits that make and move one. Lifted out of useEditorMode.ts for the reason
// useContentEdits.ts was — the hook stopped fitting on a screen — and kept apart from
// that one because a call edit needs the selection *and* the layout switch, which the
// content mutators are given neither of.

export interface CallEdits {
  /**
   * Which layout every panel that has a call scene is being shown in: `null` for its
   * ordinary pictures and balloons, a phase for its call.
   *
   * One control rather than a switch plus a phase, because "showing the default layout,
   * connected" is not a state anything could draw. It is session state and not config:
   * which layout an author is looking at is where they are standing, not something about
   * the page, so it is neither persisted nor serialized — a reload comes back on the
   * default layout with the work intact.
   */
  callPhase: CallScenePhase | null
  setCallPhase(phase: CallScenePhase | null): void
  /**
   * Turn `panel` into a phone call: the figures, the words and the red key, each an
   * ordinary picture or balloon from then on (./callSceneCreate.ts). Switches to the call
   * layout as well, because the six entries it just made are invisible on the other one —
   * an add whose result you cannot see reads as an add that did nothing.
   */
  addCallOn(panel: number): void
  /** Move one panel's seam, or turn it. A patch for a panel with no call is a no-op. */
  setCallScene(panel: number, patch: Partial<CallSceneLayout>): void
}

export function useCallEdits(apply: ApplyOp, setSelected: SetSelection): CallEdits {
  // Unlike a mode switch, this one keeps the selection. An entry that has just gone off
  // screen is still the thing the author is editing — they may have switched layouts to
  // see what it hides — and the handle that could be dragged blind is EditorOverlay's to
  // withhold, which it must do anyway to hit-test what is actually drawn.
  const [callPhase, setCallPhase] = useState<CallScenePhase | null>(null)

  const addCallOn = useCallback(
    (panel: number) => {
      let added = -1
      apply(prev => {
        const { config: next, index } = addCallScene(prev, panel)
        added = index
        return next
      })
      // Ringing: the first thing an author frames is where the two halves fall, and the
      // ringing figure is the one that stands alone in its own half.
      setCallPhase('ringing')
      // The first figure, not the last entry — a call is added to look at it, and the
      // picture is what the author drags first. A refused add hands back the picture that
      // was already there, which is the same answer.
      if (added >= 0) setSelected({ kind: 'img', index: added })
    },
    [apply, setSelected],
  )

  const setCallScene = useCallback(
    (panel: number, patch: Partial<CallSceneLayout>) =>
      apply(prev => patchCallScene(prev, panel, patch)),
    [apply],
  )

  return useMemo(
    () => ({ callPhase, setCallPhase, addCallOn, setCallScene }),
    [callPhase, addCallOn, setCallScene],
  )
}
