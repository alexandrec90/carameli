import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

import { logger } from '../../../lib/logger'
import type { PanelPoly } from '../Layout'
import { PANELS } from '../panels'
import { assetLabel } from './assets'
import InspectorPanel from './InspectorPanel'
import PageSelect from './PageSelect'
import type { PageSelectProps } from './PageSelect'
import { serializeConfig, serializeConfigFile } from './serialize'
import { bubbleRect, imgRect } from './transforms'
import { useOverlayInteraction } from './useOverlayInteraction'
import { useToolbarDrag } from './useToolbarDrag'
import type { EditorModeApi } from './useEditorMode'
import './editor.css'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface EditorOverlayProps {
  api: EditorModeApi
  panelPolys: PanelPoly[]
  pageSelect: PageSelectProps
}

/** Dev-only endpoint (Vite middleware) that overwrites editor/layoutConfig.ts. */
const SAVE_ENDPOINT = '/__comic-editor/save'

function rectStyle(r: Rect): CSSProperties {
  return { left: r.x, top: r.y, width: r.w, height: r.h }
}

/** Fallback when the save endpoint/clipboard is unavailable: download the file. */
function downloadConfig(text: string): void {
  const blob = new Blob([text], { type: 'text/typescript' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'layoutConfig.ts'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Dev-only editor overlay. Renders transparent per-panel click targets, a draggable
 * selection outline with resize/rotate handles, and a toolbar that hosts the
 * selection inspector plus Save / Reset / Copy / download actions.
 *
 * Save POSTs the serialized config to a dev-only Vite middleware that rewrites
 * editor/layoutConfig.ts on disk (HMR then reloads it); Reset reverts unsaved edits
 * to the last saved file. Both degrade to the clipboard/download fallbacks.
 */
export default function EditorOverlay({ api, panelPolys, pageSelect }: EditorOverlayProps) {
  useEffect(() => {
    logger.info('Comic-book editor overlay active', { panels: panelPolys.length })
  }, [panelPolys.length])

  const { selected, config } = api
  const interaction = useOverlayInteraction(api, panelPolys)
  const toolbarDrag = useToolbarDrag()
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

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

  const onSave = () => {
    const content = serializeConfigFile(config)
    fetch(SAVE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setSaved(true)
        logger.info('Comic-book editor: config saved to layoutConfig.ts')
        window.setTimeout(() => setSaved(false), 1500)
      })
      .catch(err => {
        logger.error('Comic-book editor: save failed, downloading instead', {
          err: String(err),
        })
        downloadConfig(content)
      })
  }

  const onCopyConfig = () => {
    const text = serializeConfig(config)
    const confirm = () => {
      setCopied(true)
      logger.info('Comic-book editor: config copied to clipboard')
      window.setTimeout(() => setCopied(false), 1500)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(confirm)
        .catch(err => {
          logger.error('Comic-book editor: clipboard write failed, downloading instead', {
            err: String(err),
          })
          downloadConfig(serializeConfigFile(config))
        })
    } else {
      downloadConfig(serializeConfigFile(config))
    }
  }

  const onDownloadConfig = () => downloadConfig(serializeConfigFile(config))

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
          way to reach a panel that has nothing on it yet. */}
      {panelPolys.map((poly, i) => (
        <button
          key={i}
          type="button"
          className="cb-ed-target"
          style={rectStyle(poly.bounds)}
          aria-label={`Select ${PANELS[i]?.label ?? `panel ${i}`}`}
          onClick={() => api.select('panel', i)}
        />
      ))}

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

      {/* Selection outline. A picture or a bubble gets a draggable body plus handles;
          a selected *panel* is only ever outlined, because a panel is a slot in the
          grid and there is nothing about it to drag. */}
      {selected?.kind === 'panel' && selectedRect && (
        <div className="cb-ed-outline cb-ed-outline-panel" style={rectStyle(selectedRect)} aria-hidden="true" />
      )}
      {selected && selected.kind !== 'panel' && selectedRect && (
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

      {/* Toolbar — draggable by its title grip so it can be moved off a panel */}
      <div className="cb-ed-toolbar" role="region" aria-label="Comic-book editor" {...toolbarDrag.rootProps}>
        <div className="cb-ed-title cb-ed-grip" title="Drag to move" {...toolbarDrag.gripProps}>COMIC EDITOR</div>
        <PageSelect {...pageSelect} />
        {selected && selPanel !== null ? (
          <InspectorPanel api={api} panel={selPanel} />
        ) : (
          <div className="cb-ed-hint">Click a panel, a picture or a bubble to select it.</div>
        )}
        <div className="cb-ed-actions">
          {/* New pictures and bubbles land on the selected panel, because there is no
              other answer to "which panel" that does not need a second click. */}
          <button
            type="button"
            className="cb-ed-btn"
            disabled={selPanel === null}
            title={
              selPanel === null
                ? 'Select a panel first'
                : `Add a picture to ${PANELS[selPanel]?.label ?? `panel ${selPanel}`}`
            }
            onClick={() => selPanel !== null && api.addImgOn(selPanel)}
          >
            + Image
          </button>
          <button
            type="button"
            className="cb-ed-btn"
            disabled={selPanel === null}
            title={
              selPanel === null
                ? 'Select a panel first'
                : `Add a bubble to ${PANELS[selPanel]?.label ?? `panel ${selPanel}`}`
            }
            onClick={() => selPanel !== null && api.addBubbleOn(selPanel)}
          >
            + Bubble
          </button>
        </div>
        <div className="cb-ed-actions">
          <button type="button" className="cb-ed-btn cb-ed-btn-primary" onClick={onSave}>
            {saved ? 'Saved!' : 'Save'}
          </button>
          <button
            type="button"
            className="cb-ed-btn"
            title="Discard unsaved changes (revert to last saved file)"
            onClick={api.resetAll}
          >
            Reset
          </button>
        </div>
        <div className="cb-ed-actions">
          <button type="button" className="cb-ed-btn" onClick={onCopyConfig}>
            {copied ? 'Copied!' : 'Copy config'}
          </button>
          <button
            type="button"
            className="cb-ed-btn cb-ed-btn-icon"
            title="Download layoutConfig.ts (clipboard/save fallback)"
            onClick={onDownloadConfig}
          >
            .ts
          </button>
        </div>
      </div>
    </div>
  )
}
