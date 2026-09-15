import { useCallback, useMemo } from 'react'

import { logger } from '../../../lib/logger'
import { frameRect } from '../panelGeometry'
import type { Rect } from '../panelGeometry'
import { splitPanel as splitPanelIn } from './configPanels'
import {
  deletePanel as deletePanelIn,
  hidePanelOn as hidePanelOnIn,
  showPanelOn as showPanelOnIn,
} from './configPanelsRemove'
import { resetGridKeepingContent, setGridKeepingContent } from './gridContentRemap'
import type { CutAxis } from './panelGridCut'
import type { SetSelection } from './selection'
import type { ApplyOp } from './useContentEdits'
import type { EditorConfig, LayoutKind, PanelGrid, PanelPage } from './types'

// The mutators for the panels *themselves* — the grid a page is cut into, and the cut
// that adds one. Apart from ./useContentEdits.ts for the reason that file gives: nothing
// here knows what is drawn in a panel, and nothing there knows about panel geometry.

/**
 * The page frame a grid edit is being looked at through: `kind`'s fixed-aspect frame in
 * this window, which is what Layout.tsx drew the panels in — so the remap that holds
 * content still while a seam is dragged measures the same boxes the author sees. The
 * kind is the caller's, not the window's: a portrait grid edited in a landscape window
 * is on a portrait frame, and reading the kind off the window here would remap it
 * against a landscape one. No window makes a zero frame, and the remap a no-op.
 */
function frameFor(kind: LayoutKind): Rect {
  return typeof window === 'undefined'
    ? { x: 0, y: 0, w: 0, h: 0 }
    : frameRect(window.innerWidth, window.innerHeight, kind)
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
  /**
   * Take `panel` off the grid on screen (`kind`) and no other: its neighbour takes the
   * space, and it stays on the other two window shapes. False when nothing can take it.
   */
  hidePanelOn(panel: number, kind: LayoutKind): boolean
  /**
   * Bring a panel hidden on `kind`'s grid back, as the lower or right half of `from` cut
   * along `axis`, and select it. False when the cut is refused.
   */
  showPanelOn(panel: number, kind: LayoutKind, from: number, axis: CutAxis): boolean
  /**
   * Delete `panel` from every grid and the list, its pictures and balloons with it. Every
   * later panel moves down one (./configPanelsRemove.ts). False when some grid of its page
   * cannot give the space away, in which case nothing changes.
   */
  deletePanel(panel: number, kind: LayoutKind): boolean
}

/**
 * The two whole-grid replacements. Neither can be refused — a grid handed in is already a
 * grid and the shipped default always exists — so these answer with nothing rather than
 * with a boolean, and the panel list they sit beside is the half that can say no.
 */
function useGridShape(apply: ApplyOp, setSelected: SetSelection) {
  const setGridFor = useCallback(
    (page: PanelPage, kind: LayoutKind, grid: PanelGrid) =>
      apply(prev => setGridKeepingContent(prev, page, kind, grid, frameFor(kind))),
    [apply],
  )

  const resetGridFor = useCallback(
    (page: PanelPage, kind: LayoutKind) => {
      apply(prev => resetGridKeepingContent(prev, page, kind, frameFor(kind)))
      // The default grid has fewer vertices than a bent one, so a surviving vertex
      // selection would point past the end of the table or at somebody else's corner.
      setSelected(null)
    },
    [apply, setSelected],
  )

  return useMemo(() => ({ setGridFor, resetGridFor }), [setGridFor, resetGridFor])
}

/**
 * The four edits that add a panel to the list or take one off it, each answering now so
 * the inspector can say why nothing happened.
 *
 * Computed against the rendered config rather than inside `apply`'s updater, because the
 * caller needs that answer now: a refused cut is reported in the inspector, and a
 * functional update cannot hand a boolean back out. Nothing else edits the config between
 * a click and its handler, so the two are the same object.
 */
function usePanelList(apply: ApplyOp, setSelected: SetSelection, config: EditorConfig) {
  const splitPanel = useCallback(
    (panel: number, axis: CutAxis, kind: LayoutKind): boolean => {
      const result = splitPanelIn(config, panel, axis, { kind, frame: frameFor(kind) })
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

  const hidePanelOn = useCallback(
    (panel: number, kind: LayoutKind): boolean => {
      const result = hidePanelOnIn(config, panel, kind, { kind, frame: frameFor(kind) })
      if (!result) {
        logger.warn('Refused to hide comic-book panel', { panel, kind })
        return false
      }
      apply(() => result)
      // The hidden panel has no target on this grid to keep a selection on.
      setSelected(null)
      return true
    },
    [apply, config, setSelected],
  )

  const showPanelOn = useCallback(
    (panel: number, kind: LayoutKind, from: number, axis: CutAxis): boolean => {
      const result = showPanelOnIn(config, panel, kind, from, axis, { kind, frame: frameFor(kind) })
      if (!result) {
        logger.warn('Refused to show comic-book panel', { panel, kind, from, axis })
        return false
      }
      apply(() => result)
      setSelected({ kind: 'panel', index: panel })
      return true
    },
    [apply, config, setSelected],
  )

  const deletePanel = useCallback(
    (panel: number, kind: LayoutKind): boolean => {
      const result = deletePanelIn(config, panel, { kind, frame: frameFor(kind) })
      if (!result) {
        logger.warn('Refused to delete comic-book panel', { panel })
        return false
      }
      apply(() => result)
      // Every index past the deleted slot moved, so no selection survives.
      setSelected(null)
      return true
    },
    [apply, config, setSelected],
  )

  return useMemo(
    () => ({ splitPanel, hidePanelOn, showPanelOn, deletePanel }),
    [splitPanel, hidePanelOn, showPanelOn, deletePanel],
  )
}

export function useGridEdits(
  apply: ApplyOp,
  setSelected: SetSelection,
  config: EditorConfig,
): GridEdits {
  const shape = useGridShape(apply, setSelected)
  const list = usePanelList(apply, setSelected, config)
  return useMemo(() => ({ ...shape, ...list }), [shape, list])
}
