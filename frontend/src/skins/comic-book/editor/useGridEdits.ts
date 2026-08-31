import { useCallback, useMemo } from 'react'

import { logger } from '../../../lib/logger'
import { splitPanel as splitPanelIn } from './configPanels'
import { resetGridKeepingContent, setGridKeepingContent } from './gridContentRemap'
import type { CutAxis } from './panelGridCut'
import type { SetSelection } from './selection'
import type { ApplyOp } from './useContentEdits'
import type { EditorConfig, LayoutKind, PanelGrid, PanelPage } from './types'

// The mutators for the panels *themselves* — the grid a page is cut into, and the cut
// that adds one. Apart from ./useContentEdits.ts for the reason that file gives: nothing
// here knows what is drawn in a panel, and nothing there knows about panel geometry.

/**
 * The viewport a grid edit is being looked at through. Layout.tsx computes panel boxes
 * from `window.innerWidth/innerHeight`, and the remap that holds content still while a
 * seam is dragged must measure with those same numbers — % of a panel box only names
 * pixels once the box does. Zero (no window) makes the remap a no-op.
 */
function viewportSize(): { w: number; h: number } {
  return typeof window === 'undefined'
    ? { w: 0, h: 0 }
    : { w: window.innerWidth, h: window.innerHeight }
}

export interface GridEdits {
  /**
   * Replace one page's panel grid for one breakpoint. Deliberately whole-grid and
   * deliberately page-and-kind-addressed: every shape edit is a pure function in
   * ./panelGridOps.ts that takes a grid and returns one, and the caller — which is the
   * thing looking at a route and a window of a known shape — says which grid it just
   * reshaped. Pictures and bubbles hold their place on screen: both are re-expressed
   * against the new panel boxes (./gridContentRemap.ts), so a seam drag moves the
   * window content is seen through, never the content.
   */
  setGridFor(page: PanelPage, kind: LayoutKind, grid: PanelGrid): void
  /** Restore one page's grid for one breakpoint to the shipped default, content held still. */
  resetGridFor(page: PanelPage, kind: LayoutKind): void
  /**
   * Cut `panel` in two through its middle — `across` for a panel above and one below,
   * `down` for side by side — in every grid of its page, appending the new half to the
   * panel list and selecting it. `kind` is the grid on screen, whose content is held
   * still. Returns false, changing nothing, when the cut is refused (./configPanels.ts).
   */
  splitPanel(panel: number, axis: CutAxis, kind: LayoutKind): boolean
}

export function useGridEdits(
  apply: ApplyOp,
  setSelected: SetSelection,
  config: EditorConfig,
): GridEdits {
  const setGridFor = useCallback(
    (page: PanelPage, kind: LayoutKind, grid: PanelGrid) =>
      apply(prev => setGridKeepingContent(prev, page, kind, grid, viewportSize())),
    [apply],
  )

  const resetGridFor = useCallback(
    (page: PanelPage, kind: LayoutKind) => {
      apply(prev => resetGridKeepingContent(prev, page, kind, viewportSize()))
      // The default grid has fewer vertices than a bent one, so a surviving vertex
      // selection would point past the end of the table or at somebody else's corner.
      setSelected(null)
    },
    [apply, setSelected],
  )

  // Computed against the rendered config rather than inside `apply`'s updater, because
  // the caller needs the answer now — a refused cut is reported in the inspector, and a
  // functional update cannot hand a boolean back out. Nothing else edits the config
  // between a click and its handler, so the two are the same object.
  const splitPanel = useCallback(
    (panel: number, axis: CutAxis, kind: LayoutKind): boolean => {
      const result = splitPanelIn(config, panel, axis, { kind, viewport: viewportSize() })
      if (!result) {
        logger.warn('Refused to split comic-book panel', { panel, axis })
        return false
      }
      apply(() => result.config)
      setSelected({ kind: 'panel', index: result.index })
      return true
    },
    [apply, config, setSelected],
  )

  return useMemo(
    () => ({ setGridFor, resetGridFor, splitPanel }),
    [setGridFor, resetGridFor, splitPanel],
  )
}
