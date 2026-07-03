import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

import { logger } from '../../../lib/logger'
import type { PanelPoly } from '../Layout'
import InspectorPanel from './InspectorPanel'
import PageSelect from './PageSelect'
import type { PageSelectProps } from './PageSelect'
import { serializeConfig, serializeConfigFile } from './transforms'
import { useOverlayInteraction } from './useOverlayInteraction'
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

/**
 * Approximate the on-screen bubble box from a panel's bounds and the bubble
 * transform (top/right/width are % of the panel box; height ≈ width).
 */
function bubbleRect(bounds: Rect, t: { top: number; right: number; width: number }): Rect {
  const w = (t.width / 100) * bounds.w
  const rightX = bounds.x + bounds.w - (t.right / 100) * bounds.w
  return {
    x: rightX - w,
    y: bounds.y + (t.top / 100) * bounds.h,
    w,
    h: w,
  }
}

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
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  const selectedRect: Rect | null =
    selected && panelPolys[selected.index]
      ? selected.kind === 'img'
        ? panelPolys[selected.index].bounds
        : bubbleRect(panelPolys[selected.index].bounds, config.bubbles[selected.index])
      : null

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

      {/* Per-panel image + bubble click targets */}
      {panelPolys.map((poly, i) => {
        const br = bubbleRect(poly.bounds, config.bubbles[i])
        return (
          <div key={i}>
            <button
              type="button"
              className="cb-ed-target"
              style={rectStyle(poly.bounds)}
              aria-label={`Select ${PANEL_LABELS[i]} image`}
              onClick={() => api.select('img', i)}
            />
            <button
              type="button"
              className="cb-ed-target cb-ed-target-bubble"
              style={rectStyle(br)}
              aria-label={`Select ${PANEL_LABELS[i]} bubble`}
              onClick={() => api.select('bubble', i)}
            />
          </div>
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

      {/* Toolbar */}
      <div className="cb-ed-toolbar" role="region" aria-label="Comic-book editor">
        <div className="cb-ed-title">COMIC EDITOR</div>
        <PageSelect {...pageSelect} />
        {selected ? (
          <InspectorPanel api={api} label={PANEL_LABELS[selected.index]} />
        ) : (
          <div className="cb-ed-hint">Click a panel image or bubble to select it.</div>
        )}
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
