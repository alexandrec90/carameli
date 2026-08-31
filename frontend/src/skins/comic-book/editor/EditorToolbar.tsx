import { useMemo } from 'react'

import type { LayoutKind, PanelGrid } from '../panelGeometry'
import type { PanelPage } from '../panels'
import AddContentButtons from './AddContentButtons'
import CallLayoutSwitch from './CallLayoutSwitch'
import { layoutViolations } from './configParity'
import InspectorPanel from './InspectorPanel'
import LayoutWarnings from './LayoutWarnings'
import PageSelect from './PageSelect'
import type { PageSelectProps } from './PageSelect'
import ShapeInspector from './ShapeInspector'
import type { EditorModeApi } from './useEditorMode'
import { useLayoutTransport } from './useLayoutTransport'
import type { SeamDragApi } from './useSeamDrag'
import { useToolbarColumns } from './useToolbarColumns'
import { useToolbarDrag } from './useToolbarDrag'

// The editor's own chrome: the mode switch, the inspector for whatever is selected, and
// the four ways a working copy leaves the browser. Split out of EditorOverlay.tsx when
// the shape editor doubled the number of things a toolbar has to hold; what each of those
// four presses *does* is ./useLayoutTransport.ts, so this file stays markup.

interface EditorToolbarProps {
  api: EditorModeApi
  /** The panel a new picture or bubble would go on, or null. */
  selPanel: number | null
  pageSelect: PageSelectProps
  shapes: { page: PanelPage; kind: LayoutKind; grid: PanelGrid; drag: SeamDragApi }
}

export default function EditorToolbar({ api, selPanel, pageSelect, shapes }: EditorToolbarProps) {
  const { config, mode } = api
  const toolbarDrag = useToolbarDrag()
  const toolbarColumns = useToolbarColumns(toolbarDrag.rootProps.ref)

  // Derived from the working copy rather than checked on the way out, so a balloon
  // finished mid-session stops being reported the moment it is finished. See
  // ./configParity.ts for which rules are structural and which belong to today's layout.
  const violations = useMemo(() => layoutViolations(config), [config])
  const transport = useLayoutTransport(config, api.stale, violations.length)
  const { save, ship } = transport

  const saveLabel =
    save.phase === 'done' ? 'Saved!' : save.phase === 'confirm' ? 'Overwrite it?' : 'Save'

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
        <>
          <AddContentButtons api={api} selPanel={selPanel} />
          <CallLayoutSwitch api={api} />
        </>
      )}

      <div className="cb-ed-actions">
        <button
          type="button"
          className="cb-ed-btn cb-ed-btn-primary"
          onClick={transport.onSave}
          title={api.stale ? 'The config file has changed since this working copy started' : undefined}
        >
          {saveLabel}
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
      <LayoutWarnings violations={violations} stale={api.stale} />
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
          value={transport.summary}
          onChange={e => transport.setSummary(e.target.value)}
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
          onClick={transport.onShip}
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
        <button type="button" className="cb-ed-btn" onClick={transport.onCopyConfig}>
          {transport.copied ? 'Copied!' : 'Copy config'}
        </button>
        <button
          type="button"
          className="cb-ed-btn cb-ed-btn-icon"
          title="Download layoutConfig.ts (clipboard/save fallback)"
          onClick={transport.onDownload}
        >
          .ts
        </button>
      </div>
    </div>
  )
}
