import { useEffect } from 'react'

import { logger } from '../../../lib/logger'
import type { LayoutKind, PanelPoly } from '../panelGeometry'
import { frameRect } from '../panelGeometry'
import type { PanelPage } from '../panels'
import EditorToolbar from './EditorToolbar'
import { boxOf, overlaySelection, useCallOverlay } from './overlayGeometry'
import OverlayTargets from './OverlayTargets'
import type { PageSelectProps } from './PageSelect'
import PanelSeams from './PanelSeams'
import SelectionOutline from './SelectionOutline'
import SurfaceCorners from './TableCorners'
import { imgRect, surfaceBaseRect } from './transforms'
import { useOverlayInteraction } from './useOverlayInteraction'
import { useSeamDrag } from './useSeamDrag'
import type { EditorModeApi } from './useEditorMode'
import './editor.css'
import './editor-toolbar.css'
import './editor-shapes.css'

interface EditorOverlayProps {
  api: EditorModeApi
  /** One entry per panel slot; null where the panel lives on the other page. */
  panelPolys: (PanelPoly | null)[]
  /** Which page's grids this route is showing, so shape edits reach the right record. */
  page: PanelPage
  /** Natural pixel size of each loaded source, keyed by `src` — sizes the visible
      image rect the hover and selection outlines trace. */
  natSizes: Record<string, { w: number; h: number }>
  /** Which of the three grids this window is showing, so shape edits reach the right one. */
  layoutKind: LayoutKind
  /** Viewport size in px — the shape editor needs the page frame, not the panels. */
  viewport: { w: number; h: number }
  pageSelect: PageSelectProps
}

/**
 * Dev-only editor overlay, in two modes.
 *
 * *Content* renders transparent per-panel click targets and a draggable selection
 * outline with resize/rotate/pan handles, for placing pictures and bubbles.
 *
 * *Panel shapes* puts the picture and bubble targets away and draws the grid itself: a
 * handle on every line two panels share and on every corner those lines meet at. The
 * outer frame gets neither, which is how it stays fixed — see PanelSeams.tsx. The
 * panel targets stay, under the seams, so a panel can be selected and cut in two.
 *
 * Both write through the same working copy, which Save POSTs to a dev-only Vite
 * middleware that rewrites editor/layoutConfig.ts on disk (see EditorToolbar.tsx).
 */
export default function EditorOverlay({
  api,
  panelPolys,
  page,
  natSizes,
  layoutKind,
  viewport,
  pageSelect,
}: EditorOverlayProps) {
  useEffect(() => {
    logger.info('Comic-book editor overlay active', { panels: panelPolys.length })
  }, [panelPolys.length])

  const { selected, config, mode } = api
  const shapeMode = mode === 'shapes'
  const interaction = useOverlayInteraction(api, panelPolys)

  const grid = config.grids[page][layoutKind]
  const frame = frameRect(viewport.w, viewport.h)
  const drag = useSeamDrag(api, page, layoutKind, grid, frame)

  // Which layout the calls are showing, where each seam falls, and the box the selection
  // occupies once both are known — all of it ./overlayGeometry.ts, so the targets, the
  // outline and the grips are placed against the same answer the panels drew from.
  const { callRoles, halvesOn } = useCallOverlay(api.callPhase, config.callScenes, panelPolys)
  const { selImg, selPanel, selPoly, selHalves, selectedRect } =
    overlaySelection(api, panelPolys, natSizes, halvesOn, callRoles)

  return (
    <div className="cb-ed-layer">
      {/* Empty-space click target — clears the selection */}
      <button
        type="button"
        className="cb-ed-backdrop"
        aria-label="Clear selection"
        onClick={api.clear}
      />

      <OverlayTargets
        api={api}
        panelPolys={panelPolys}
        natSizes={natSizes}
        callRoles={callRoles}
        halvesOn={halvesOn}
        shapeMode={shapeMode}
      />

      <SelectionOutline
        selected={selected}
        rect={selectedRect}
        shapeMode={shapeMode}
        interaction={interaction}
      />

      {/* The grips for whichever projected content the selected picture carries. They paint after
          the selection outline so a corner dragged inside the frame still wins the
          pointer over the body that would otherwise move the whole picture. */}
      {!shapeMode && selected?.kind === 'img' && (selImg?.table || selImg?.numberPad) && selPoly && selectedRect && (
        <SurfaceCorners
          api={api}
          index={selected.index}
          surface={selImg.table ?? selImg.numberPad!}
          kind={selImg.table ? 'table' : 'numberPad'}
          rect={surfaceBaseRect(
            imgRect(boxOf(selImg, selPoly.bounds, selHalves), selImg),
            natSizes[selImg.src],
            selImg,
          )}
        />
      )}

      {shapeMode && <PanelSeams grid={grid} frame={frame} drag={drag} />}

      {/* Toolbar — draggable by its title grip so it can be moved off a panel */}
      <EditorToolbar
        api={api}
        selPanel={selPanel}
        pageSelect={pageSelect}
        shapes={{ page, kind: layoutKind, grid, drag }}
      />
    </div>
  )
}
