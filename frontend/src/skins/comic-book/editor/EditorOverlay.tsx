import { useEffect } from 'react'
import type { CSSProperties } from 'react'

import { logger } from '../../../lib/logger'
import type { LayoutKind, PanelPoly, Rect } from '../panelGeometry'
import { frameRect } from '../panelGeometry'
import type { PanelPage } from '../panels'
import { PANELS } from '../panels'
import { assetLabel } from './assets'
import EditorToolbar from './EditorToolbar'
import type { PageSelectProps } from './PageSelect'
import PanelSeams from './PanelSeams'
import { bubbleRect, imgRect } from './transforms'
import { useOverlayInteraction } from './useOverlayInteraction'
import { useSeamDrag } from './useSeamDrag'
import type { EditorModeApi } from './useEditorMode'
import './editor.css'
import './editor-shapes.css'

interface EditorOverlayProps {
  api: EditorModeApi
  /** One entry per PANELS slot; null where the panel lives on the other page. */
  panelPolys: (PanelPoly | null)[]
  /** Which page's grids this route is showing, so shape edits reach the right record. */
  page: PanelPage
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
 * Dev-only editor overlay, in two modes.
 *
 * *Content* renders transparent per-panel click targets and a draggable selection
 * outline with resize/rotate/pan handles, for placing pictures and bubbles.
 *
 * *Panel shapes* puts those away and draws the grid itself: a handle on every line two
 * panels share and on every corner those lines meet at. The outer frame gets neither,
 * which is how it stays fixed — see PanelSeams.tsx.
 *
 * Both write through the same working copy, which Save POSTs to a dev-only Vite
 * middleware that rewrites editor/layoutConfig.ts on disk (see EditorToolbar.tsx).
 */
export default function EditorOverlay({
  api,
  panelPolys,
  page,
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

  const selectedRect: Rect | null = !selPoly
    ? null
    : selImg
      ? imgRect(selPoly.bounds, selImg)
      : selBubble
        ? bubbleRect(selPoly.bounds, selBubble)
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

      {/* The content targets are not merely hidden in shapes mode, they are not rendered:
          a panel-sized click target sitting over a seam would eat every drag aimed at the
          line running through it. */}
      {!shapeMode && (
        <>
          {/* Per-panel click targets — the backdrop for everything drawn on a panel.
              Selecting a panel is what "+ Image" and "+ Bubble" act on, and it is the only
              way to reach a panel that has nothing on it yet. */}
          {panelPolys.map((poly, i) =>
            poly === null ? null : (
              <button
                key={i}
                type="button"
                className="cb-ed-target"
                style={rectStyle(poly.bounds)}
                aria-label={`Select ${PANELS[i]?.label ?? `panel ${i}`}`}
                onClick={() => api.select('panel', i)}
              />
            ),
          )}

          {/* One click target per picture, on its own frame. They paint after the panel
              targets so a picture wins the click where the two overlap — which is always,
              since a frame lives on a panel. */}
          {config.images.map((img, i) => {
            const poly = panelPolys[img.panel]
            if (!poly) return null
            return (
              <button
                key={i}
                type="button"
                className="cb-ed-target cb-ed-target-img"
                style={rectStyle(imgRect(poly.bounds, img))}
                aria-label={`Select ${assetLabel(img.src)} on ${PANELS[img.panel]?.label ?? `panel ${img.panel}`}`}
                onClick={() => api.select('img', i)}
              />
            )
          })}

          {/* One click target per bubble, placed against the panel it belongs to. They
              paint last so a bubble stays clickable where it overlaps a picture, its own
              panel — or a neighbour's, once it spills into the gutter. */}
          {config.bubbles.map((bubble, i) => {
            const poly = panelPolys[bubble.panel]
            if (!poly) return null
            return (
              <button
                key={i}
                type="button"
                className="cb-ed-target cb-ed-target-bubble"
                style={rectStyle(bubbleRect(poly.bounds, bubble))}
                aria-label={`Select ${PANELS[bubble.panel]?.label ?? `panel ${bubble.panel}`} bubble ${i}`}
                onClick={() => api.select('bubble', i)}
              />
            )
          })}
        </>
      )}

      {/* Selection outline. A picture or a bubble gets a draggable body plus handles;
          a selected *panel* is only ever outlined, because a panel is a slot in the
          grid and there is nothing about it to drag. */}
      {!shapeMode && selected?.kind === 'panel' && selectedRect && (
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
