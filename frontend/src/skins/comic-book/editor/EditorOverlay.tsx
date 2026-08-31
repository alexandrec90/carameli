import { useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'

import { logger } from '../../../lib/logger'
import { splitAt } from '../callSceneGeometry'
import type { SceneHalves } from '../callSceneGeometry'
import { halfFor, inRoles, rolesAtPhase } from '../callSceneRoles'
import type { LayoutKind, PanelPoly, Rect } from '../panelGeometry'
import { frameRect } from '../panelGeometry'
import type { PanelPage } from '../panels'
import { assetLabel } from './assets'
import { chainFramesOn } from './chainFrame'
import type { ChainFrame } from './chainFrame'
import EditorToolbar from './EditorToolbar'
import type { BubbleChain, BubbleTransform, CallRole } from './types'
import type { PageSelectProps } from './PageSelect'
import PanelSeams from './PanelSeams'
import SurfaceCorners from './TableCorners'
import { bubbleRect, imgRect, imgVisibleRect, surfaceBaseRect } from './transforms'
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

function rectStyle(r: Rect): CSSProperties {
  return { left: r.x, top: r.y, width: r.w, height: r.h }
}

/**
 * The box an entry is placed against: its half of a call, or the panel itself. The same
 * answer PanelImages and PanelBubbles get from `halfFor`, which is the point — a target
 * measured against the panel while the drawing is measured against a half is a target
 * that sits somewhere its picture is not.
 */
function boxOf(
  entry: { call?: CallRole },
  bounds: Rect,
  halves: SceneHalves | null,
): Rect {
  return halfFor(entry.call, halves)?.box ?? bounds
}

/**
 * Chain frames for one panel, each conversation measured against the box its own balloons
 * are placed in. Three passes rather than one because a call's two halves are two boxes,
 * and a conversation drawn on one of them is % of that half.
 */
function chainFramesFor(
  bubbles: readonly BubbleTransform[],
  chains: readonly BubbleChain[],
  panel: number,
  bounds: Rect,
  halves: SceneHalves | null,
  callRoles: CallRole[] | null,
): ChainFrame[] {
  const shown = bubbles.filter(b => inRoles(b.call, callRoles))
  if (!halves) return chainFramesOn(shown, chains, panel, bounds)
  const inHalf = (half: SceneHalves['a'] | null) =>
    shown.filter(b => halfFor(b.call, halves) === half)
  return [
    ...chainFramesOn(inHalf(halves.a), chains, panel, halves.a.box),
    ...chainFramesOn(inHalf(halves.b), chains, panel, halves.b.box),
    ...chainFramesOn(inHalf(null), chains, panel, bounds),
  ]
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

  // Which layout the page's calls are showing, and where each one's seam falls — the same
  // two facts ComicPanel works out for itself, because the overlay is not inside a panel
  // and there is nothing to hand it down. `null` roles is the ordinary layout, and then
  // every call entry is off screen and has no target.
  const callRoles = api.callPhase === null ? null : rolesAtPhase(api.callPhase)
  const halvesByPanel = useMemo(() => {
    const out = new Map<number, SceneHalves>()
    if (api.callPhase === null) return out
    for (const scene of config.callScenes) {
      const poly = panelPolys[scene.panel]
      if (poly) out.set(scene.panel, splitAt(poly.vp, poly.bounds, scene.cut, scene.axis))
    }
    return out
  }, [api.callPhase, config.callScenes, panelPolys])
  const halvesOn = (panel: number): SceneHalves | null => halvesByPanel.get(panel) ?? null

  // Everything drawn is placed against the panel it *names*, never against a panel
  // that shares its index — those parted company once a panel could own several of
  // each. A `panel` selection is the panel itself, and is how "which panel does a new
  // picture or bubble go on" gets an answer without a second click.
  const selImg = selected?.kind === 'img' ? config.images[selected.index] : null
  const selBubble = selected?.kind === 'bubble' ? config.bubbles[selected.index] : null
  const selPanel =
    selected === null
      ? null
      : selected.kind === 'panel'
        ? selected.index
        : (selImg?.panel ?? selBubble?.panel ?? null)
  const selPoly = selPanel === null ? null : panelPolys[selPanel]

  // The selection's own box, which is its half's when it is part of the call on screen.
  // An entry hidden by the current layout gets none: a handle over something that is not
  // drawn drags a picture the author cannot see moving.
  const selHalves = selPanel === null ? null : halvesOn(selPanel)
  const selShown = selImg ?? selBubble
  const selectedRect: Rect | null =
    !selPoly || (selShown !== null && !inRoles(selShown.call, callRoles))
      ? null
      : selImg
        ? imgVisibleRect(boxOf(selImg, selPoly.bounds, selHalves), natSizes[selImg.src], selImg)
        : selBubble
          ? bubbleRect(boxOf(selBubble, selPoly.bounds, selHalves), selBubble)
          : selPoly.bounds

  return (
    <div className="cb-ed-layer">
      {/* Empty-space click target — clears the selection */}
      <button
        type="button"
        className="cb-ed-backdrop"
        aria-label="Clear selection"
        onClick={api.clear}
      />

      {/* Per-panel click targets — the backdrop for everything drawn on a panel.
          Selecting a panel is what "+ Image" and "+ Bubble" act on, and it is the only
          way to reach a panel that has nothing on it yet. Rendered in both modes: in
          shapes mode a selected panel is what the split buttons cut, and the targets
          paint *before* the seam layer, so a seam or a corner running across one still
          takes the pointer — only the space between the lines selects the panel. */}
      {panelPolys.map((poly, i) =>
        poly === null ? null : (
          <button
            key={i}
            type="button"
            className="cb-ed-target"
            style={rectStyle(poly.bounds)}
            aria-label={`Select ${config.panels[i]?.label ?? `panel ${i}`}`}
            onClick={() => api.select('panel', i)}
          />
        ),
      )}

      {/* The picture and bubble targets are not merely hidden in shapes mode, they are
          not rendered: a picture-sized click target sitting over a seam would eat every
          drag aimed at the line running through it. */}
      {!shapeMode && (
        <>
          {/* One click target per picture, on the rectangle its pixels visibly occupy —
              the image, not the frame it hangs in. They paint after the panel targets so
              a picture wins the click where the two overlap. */}
          {config.images.map((img, i) => {
            const poly = panelPolys[img.panel]
            if (!poly || !inRoles(img.call, callRoles)) return null
            const box = boxOf(img, poly.bounds, halvesOn(img.panel))
            return (
              <button
                key={i}
                type="button"
                className="cb-ed-target cb-ed-target-img"
                style={rectStyle(imgVisibleRect(box, natSizes[img.src], img))}
                aria-label={`Select ${assetLabel(img.src)} on ${config.panels[img.panel]?.label ?? `panel ${img.panel}`}`}
                onClick={() => api.select('img', i)}
              />
            )
          })}

          {/* One click target per bubble, placed against the panel it belongs to. They
              paint last so a bubble stays clickable where it overlaps a picture, its own
              panel — or a neighbour's, once it spills into the gutter. */}
          {config.bubbles.map((bubble, i) => {
            const poly = panelPolys[bubble.panel]
            if (!poly || !inRoles(bubble.call, callRoles)) return null
            const box = boxOf(bubble, poly.bounds, halvesOn(bubble.panel))
            return (
              <button
                key={i}
                type="button"
                className="cb-ed-target cb-ed-target-bubble"
                style={rectStyle(bubbleRect(box, bubble))}
                aria-label={`Select ${config.panels[bubble.panel]?.label ?? `panel ${bubble.panel}`} bubble ${i}`}
                onClick={() => api.select('bubble', i)}
              />
            )
          })}

          {/* Where each conversation's rows will actually land. Chains render *flat* in
              edit mode so both templates stay selectable, which left the table itself
              drawn nowhere the author could see — so dragging a template or changing
              `rows` were edits with invisible results, and the editor read as disagreeing
              with the page. The frame is chrome, not a control: it takes no pointer, and
              stretching the table is still done by moving the two balloons it is measured
              from. */}
          {panelPolys.map((poly, i) =>
            poly === null
              ? null
              : chainFramesFor(
                config.bubbles, config.chains, i, poly.bounds, halvesOn(i), callRoles,
              ).map((frame, k) => (
                <div
                  // Keyed by position as well as by id: a conversation whose two columns
                  // sit on opposite halves of a call is measured once per half, so the
                  // same id can be two frames.
                  key={`${i}:${k}:${frame.id}`}
                  className="cb-ed-chainbox"
                  style={rectStyle(frame.rect)}
                  aria-hidden="true"
                />
              )),
          )}
        </>
      )}

      {/* Selection outline. A picture or a bubble gets a draggable body plus handles;
          a selected *panel* is only ever outlined, because a panel is a slot in the
          grid and there is nothing about it to drag — in either mode. */}
      {selected?.kind === 'panel' && selectedRect && (
        <div className="cb-ed-outline cb-ed-outline-panel" style={rectStyle(selectedRect)} aria-hidden="true" />
      )}
      {!shapeMode && selected && selected.kind !== 'panel' && selectedRect && (
        <div
          className="cb-ed-outline"
          style={rectStyle(selectedRect)}
          aria-hidden="true"
          onPointerDown={e => interaction.beginDrag(e, 'move')}
          onPointerMove={interaction.onPointerMove}
          onPointerUp={interaction.onPointerUp}
          onWheel={interaction.onWheel}
        >
          <div
            className="cb-ed-handle cb-ed-handle-br"
            title={selected.kind === 'img' ? 'Drag to resize the frame' : 'Drag to resize'}
            onPointerDown={e => interaction.beginDrag(e, 'resize')}
            onPointerMove={interaction.onPointerMove}
            onPointerUp={interaction.onPointerUp}
          />
          {/* A picture has two framings, so it needs two grips: the body moves the
              frame across the panel, this one slides the picture behind it. Dragging
              the body used to do the second thing, which is the whole complaint. */}
          {selected.kind === 'img' && (
            <div
              className="cb-ed-handle cb-ed-handle-pan"
              title="Drag to pan the picture inside its frame"
              onPointerDown={e => interaction.beginDrag(e, 'pan')}
              onPointerMove={interaction.onPointerMove}
              onPointerUp={interaction.onPointerUp}
            />
          )}
          {selected.kind === 'bubble' && (
            <div
              className="cb-ed-handle cb-ed-handle-rot"
              title="Drag to rotate"
              onPointerDown={e => interaction.beginDrag(e, 'rotate')}
              onPointerMove={interaction.onPointerMove}
              onPointerUp={interaction.onPointerUp}
            />
          )}
        </div>
      )}

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
