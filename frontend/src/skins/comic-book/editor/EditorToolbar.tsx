import { useMemo, useState } from 'react'

import { logger } from '../../../lib/logger'
import type { LayoutKind, PanelGrid } from '../panelGeometry'
import type { PanelPage } from '../panels'
import { layoutViolations } from './configParity'
import InspectorPanel from './InspectorPanel'
import LayoutWarnings from './LayoutWarnings'
import PageSelect from './PageSelect'
import type { PageSelectProps } from './PageSelect'
import { serializeConfig, serializeConfigFile } from './serialize'
import ShapeInspector from './ShapeInspector'
import type { EditorModeApi } from './useEditorMode'
import type { SeamDragApi } from './useSeamDrag'
import { useToolbarColumns } from './useToolbarColumns'
import { useToolbarDrag } from './useToolbarDrag'

// The editor's own chrome: the mode switch, the inspector for whatever is selected, and
// the four ways a working copy leaves the browser. Split out of EditorOverlay.tsx when
// the shape editor doubled the number of things a toolbar has to hold.

/** Dev-only endpoint (Vite middleware) that overwrites editor/layoutConfig.ts. */
const SAVE_ENDPOINT = '/__comic-editor/save'

/**
 * Dev-only endpoint that saves *and* then branches, commits, pushes and opens or
 * updates a PR. Save alone writes into whichever tree the dev server is serving, and
 * two of the three that run this editor — a detached `.ui-previews/` copy, the static
 * checkout — hold that file somewhere git is not watching and a cleanup can delete.
 * See `frontend/shipLayout.ts` for the whole of that reasoning.
 */
const SHIP_ENDPOINT = '/__comic-editor/ship'

/** What the ship endpoint answers with; mirrors ShipOutcome in frontend/shipLayout.ts. */
interface ShipResponse {
  ok: boolean
  message: string
  branch?: string
  prUrl?: string
}

type ShipState =
  | { phase: 'idle' }
  | { phase: 'busy' }
  | { phase: 'done'; message: string; prUrl?: string }
  | { phase: 'error'; message: string }

/**
 * Save's outcome, as a state rather than a boolean, because the failure has to be
 * *visible*. A save that cannot write the file falls back to downloading it, and while
 * that fallback was announced only in the log the button said "Save" again a moment
 * later — indistinguishable from a save that worked. That is how a broken write target
 * went unnoticed: every press downloaded a copy of `layoutConfig.ts` and the editor's
 * work never reached the app outside edit mode.
 */
type SaveState = { phase: 'idle' } | { phase: 'done' } | { phase: 'error'; message: string }

interface EditorToolbarProps {
  api: EditorModeApi
  /** The panel a new picture or bubble would go on, or null. */
  selPanel: number | null
  pageSelect: PageSelectProps
  shapes: { page: PanelPage; kind: LayoutKind; grid: PanelGrid; drag: SeamDragApi }
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
  const toolbarColumns = useToolbarColumns(toolbarDrag.rootProps.ref)
  const [copied, setCopied] = useState(false)
  const [save, setSave] = useState<SaveState>({ phase: 'idle' })
  const [summary, setSummary] = useState('')
  const [ship, setShip] = useState<ShipState>({ phase: 'idle' })

  // Derived from the working copy rather than checked on the way out, so a balloon
  // finished mid-session stops being reported the moment it is finished. See
  // ./configParity.ts for which rules are structural and which belong to today's layout.
  const violations = useMemo(() => layoutViolations(config), [config])

  const onShip = () => {
    setShip({ phase: 'busy' })
    const content = serializeConfigFile(config)
    fetch(SHIP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, summary }),
    })
      .then(res => res.json().then((body: ShipResponse) => ({ res, body })))
      .then(({ res, body }) => {
        if (!res.ok || !body.ok) throw new Error(body?.message ?? `HTTP ${res.status}`)
        setShip({ phase: 'done', message: body.message, prUrl: body.prUrl })
        logger.info('Comic-book editor: layout shipped', { message: body.message })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        setShip({ phase: 'error', message })
        logger.error('Comic-book editor: ship failed', { err: message })
      })
  }

  const onSave = () => {
    const content = serializeConfigFile(config)
    fetch(SAVE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setSave({ phase: 'done' })
        // The count goes in the log because it is the record of what the *file* now
        // holds: the author sees the list in the toolbar, but whoever finds this tree
        // afterwards sees only the file.
        logger.info('Comic-book editor: config saved to layoutConfig.ts', {
          unfinished: violations.length,
        })
        window.setTimeout(() => setSave({ phase: 'idle' }), 1500)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('Comic-book editor: save failed, downloading instead', { err: message })
        // The download stays — it is the only copy of the work when the endpoint is
        // gone — but it is now announced, so it cannot read as a save that worked.
        setSave({ phase: 'error', message })
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
    <div
      className="cb-ed-toolbar"
      role="region"
      aria-label="Comic-book editor"
      {...toolbarDrag.rootProps}
      style={{ ...toolbarDrag.rootProps.style, ...toolbarColumns }}
    >
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
        <ShapeInspector api={api} page={shapes.page} kind={shapes.kind} grid={shapes.grid} drag={shapes.drag} />
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
                : `Add a picture to ${api.config.panels[selPanel]?.label ?? `panel ${selPanel}`}`
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
                : `Add a bubble to ${api.config.panels[selPanel]?.label ?? `panel ${selPanel}`}`
            }
            onClick={() => selPanel !== null && api.addBubbleOn(selPanel)}
          >
            + Bubble
          </button>
        </div>
      )}

      <div className="cb-ed-actions">
        <button type="button" className="cb-ed-btn cb-ed-btn-primary" onClick={onSave}>
          {save.phase === 'done' ? 'Saved!' : 'Save'}
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
      {save.phase === 'error' && (
        <p role="status" className="cb-ed-status cb-ed-status-error">
          Save failed ({save.message}) — the file was downloaded instead, so the app
          outside edit mode still shows the old layout.
        </p>
      )}
      <LayoutWarnings violations={violations} />
      {/* Save writes the file; Ship carries it to a branch and a PR. They are separate
          buttons because Save is the inner loop — pressed every few drags — and Ship is
          the moment the work should stop being local to one tree.

          Which is also why only Ship is held while something is unfinished. Refusing to
          Save would take the inner loop away from an author who is mid-design — the exact
          moment a layout is *meant* to be half-built — and the work would go nowhere but
          a download. A PR carrying a half-built balloon is a different thing: it fails the
          parity test for a reason nobody on the review can act on. */}
      <div className="cb-ed-actions">
        <input
          type="text"
          className="cb-ed-ship-summary"
          aria-label="Ship summary"
          placeholder="What changed (optional)"
          value={summary}
          onChange={e => setSummary(e.target.value)}
        />
        <button
          type="button"
          className="cb-ed-btn cb-ed-btn-primary cb-ed-btn-icon"
          title={
            violations.length > 0
              ? 'Finish the balloons listed above first — a PR carrying one of these fails the layout tests'
              : 'Save, then commit and push this layout and open or update its PR'
          }
          disabled={ship.phase === 'busy' || violations.length > 0}
          onClick={onShip}
        >
          {ship.phase === 'busy' ? 'Shipping…' : 'Ship'}
        </button>
      </div>
      {ship.phase !== 'idle' && ship.phase !== 'busy' && (
        <p
          role="status"
          className={`cb-ed-status${ship.phase === 'error' ? ' cb-ed-status-error' : ''}`}
        >
          {ship.message}
          {ship.phase === 'done' && ship.prUrl && (
            <>
              {' '}
              <a href={ship.prUrl} target="_blank" rel="noreferrer">
                Open PR
              </a>
            </>
          )}
        </p>
      )}

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
