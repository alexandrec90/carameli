import { useState } from 'react'

import { logger } from '../../../lib/logger'
import type { LayoutKind, PanelGrid } from '../panelGeometry'
import { PANELS } from '../panels'
import InspectorPanel from './InspectorPanel'
import PageSelect from './PageSelect'
import type { PageSelectProps } from './PageSelect'
import { serializeConfig, serializeConfigFile } from './serialize'
import ShapeInspector from './ShapeInspector'
import type { EditorModeApi } from './useEditorMode'
import type { SeamDragApi } from './useSeamDrag'
import { useToolbarDrag } from './useToolbarDrag'

// The editor's own chrome: the mode switch, the inspector for whatever is selected, and
// the four ways a working copy leaves the browser. Split out of EditorOverlay.tsx when
// the shape editor doubled the number of things a toolbar has to hold.

/** Dev-only endpoint (Vite middleware) that overwrites editor/layoutConfig.ts. */
const SAVE_ENDPOINT = '/__comic-editor/save'

interface EditorToolbarProps {
  api: EditorModeApi
  /** The panel a new picture or bubble would go on, or null. */
  selPanel: number | null
  pageSelect: PageSelectProps
  shapes: { kind: LayoutKind; grid: PanelGrid; drag: SeamDragApi }
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

export default function EditorToolbar({ api, selPanel, pageSelect, shapes }: EditorToolbarProps) {
  const { config, mode } = api
  const toolbarDrag = useToolbarDrag()
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

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
        logger.error('Comic-book editor: save failed, downloading instead', { err: String(err) })
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

  return (
    <div className="cb-ed-toolbar" role="region" aria-label="Comic-book editor" {...toolbarDrag.rootProps}>
      <div className="cb-ed-title cb-ed-grip" title="Drag to move" {...toolbarDrag.gripProps}>COMIC EDITOR</div>

      {/* Content or shapes — see EditMode in ./selection.ts for why these are modes and
          not one surface. */}
      <div className="cb-ed-modes" role="group" aria-label="Edit mode">
        <button
          type="button"
          className={`cb-ed-btn${mode === 'content' ? ' cb-ed-btn-on' : ''}`}
          onClick={() => api.setMode('content')}
        >
          Content
        </button>
        <button
          type="button"
          className={`cb-ed-btn${mode === 'shapes' ? ' cb-ed-btn-on' : ''}`}
          onClick={() => api.setMode('shapes')}
        >
          Panel shapes
        </button>
      </div>

      <PageSelect {...pageSelect} />

      {mode === 'shapes' ? (
        <ShapeInspector api={api} kind={shapes.kind} grid={shapes.grid} drag={shapes.drag} />
      ) : api.selected && selPanel !== null ? (
        <InspectorPanel api={api} panel={selPanel} />
      ) : (
        <div className="cb-ed-hint">Click a panel, a picture or a bubble to select it.</div>
      )}

      {mode === 'content' && (
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
          onClick={() => downloadConfig(serializeConfigFile(config))}
        >
          .ts
        </button>
      </div>
    </div>
  )
}
