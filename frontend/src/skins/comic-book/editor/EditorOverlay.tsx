import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

import { logger } from '../../../lib/logger'
import type { PanelPoly } from '../Layout'
import InspectorPanel from './InspectorPanel'
import PageSelect from './PageSelect'
import type { PageSelectProps } from './PageSelect'
import { serializeConfig, serializeConfigFile } from './serialize'
import { bubbleRect } from './transforms'
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

const PANEL_LABELS = [
  'Logo',
  'Switchboard',
  'Mailman 1',
  'Mechanic',
  'Receptionist',
  'Rolodex',
  'Rotary phone',
  'Mailman 2',
]

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

  // A bubble is placed against the panel it belongs to, not against a panel that
  // shares its index — those parted company once a panel could own several bubbles.
  const selBubble = selected?.kind === 'bubble' ? config.bubbles[selected.index] : null
  const selPanel =
    selected === null
      ? null
      : selected.kind === 'img'
        ? selected.index
        : (selBubble?.panel ?? null)
  const selPoly = selPanel === null ? null : panelPolys[selPanel]

  const selectedRect: Rect | null = !selPoly
    ? null
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

      {/* Per-panel image click targets */}
      {panelPolys.map((poly, i) => (
        <button
          key={i}
          type="button"
          className="cb-ed-target"
          style={rectStyle(poly.bounds)}
          aria-label={`Select ${PANEL_LABELS[i]} image`}
          onClick={() => api.select('img', i)}
        />
      ))}

      {/* One click target per bubble, placed against the panel it belongs to. They
          paint after the image targets so a bubble stays clickable where it overlaps
          its own panel — or a neighbour's, once it spills into the gutter. */}
      {config.bubbles.map((bubble, i) => {
        const poly = panelPolys[bubble.panel]
        if (!poly) return null
        return (
          <button
            key={i}
            type="button"
            className="cb-ed-target cb-ed-target-bubble"
            style={rectStyle(bubbleRect(poly.bounds, bubble))}
            aria-label={`Select ${PANEL_LABELS[bubble.panel]} bubble ${i}`}
            onClick={() => api.select('bubble', i)}
          />
        )
      })}

      {/* Selection outline — draggable body + resize/rotate handles */}
      {selected && selectedRect && (
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
            title={selected.kind === 'img' ? 'Drag to zoom' : 'Drag to resize'}
            onPointerDown={e => interaction.beginDrag(e, 'resize')}
            onPointerMove={interaction.onPointerMove}
            onPointerUp={interaction.onPointerUp}
          />
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
          <InspectorPanel api={api} label={PANEL_LABELS[selPanel]} labels={PANEL_LABELS} />
        ) : (
          <div className="cb-ed-hint">Click a panel image or bubble to select it.</div>
        )}
        <div className="cb-ed-actions">
          {/* New bubbles land on the selected panel, because there is no other
              answer to "which panel" that does not need a second click. */}
          <button
            type="button"
            className="cb-ed-btn"
            disabled={selPanel === null}
            title={
              selPanel === null
                ? 'Select a panel or bubble first'
                : `Add a bubble to ${PANEL_LABELS[selPanel]}`
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
