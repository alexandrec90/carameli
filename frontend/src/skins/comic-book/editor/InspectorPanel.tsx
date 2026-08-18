import BubbleInspector from './BubbleInspector'
import type { EditorModeApi } from './useEditorMode'

interface InspectorPanelProps {
  api: EditorModeApi
  /** Human-readable name of the panel the selection belongs to. */
  label: string
  /** Every panel's name, indexed like PANEL_IMAGES — for the panel/link pickers. */
  labels: string[]
}

/** Trim drag-produced floats to 2 decimals for the read-out (drops trailing zeros). */
function fmt(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Selection inspector: live numeric read-outs plus editable controls for the
 * currently selected image or bubble, and a per-element reset. The bubble-only
 * controls live in BubbleInspector. Rendered inside the toolbar by EditorOverlay
 * only when something is selected.
 */
export default function InspectorPanel({ api, label, labels }: InspectorPanelProps) {
  const { selected, config } = api
  if (!selected) return null

  const selImg = selected.kind === 'img' ? config.images[selected.index] : null
  const selBubble = selected.kind === 'bubble' ? config.bubbles[selected.index] : null
  if (!selImg && !selBubble) return null

  return (
    <>
      <div className="cb-ed-label">
        {label} {selected.kind === 'img' ? 'image' : 'bubble'}
      </div>

      <dl className="cb-ed-values">
        {selImg && (
          <>
            <div><dt>scale</dt><dd>{fmt(selImg.scale)}</dd></div>
            <div><dt>offsetX</dt><dd>{fmt(selImg.offsetX)}</dd></div>
            <div><dt>offsetY</dt><dd>{fmt(selImg.offsetY)}</dd></div>
            <div><dt>anchor</dt><dd>{selImg.anchor}</dd></div>
          </>
        )}
        {selBubble && (
          <>
            <div><dt>top</dt><dd>{fmt(selBubble.top)}%</dd></div>
            <div><dt>right</dt><dd>{fmt(selBubble.right)}%</dd></div>
            <div><dt>width</dt><dd>{fmt(selBubble.width)}%</dd></div>
            <div><dt>rotate</dt><dd>{fmt(selBubble.rotate)}°</dd></div>
          </>
        )}
      </dl>

      {selBubble && (
        <BubbleInspector
          api={api}
          index={selected.index}
          bubble={selBubble}
          labels={labels}
        />
      )}

      {/* Spill toggle — shared by images and bubbles */}
      <label className="cb-ed-check">
        <input
          type="checkbox"
          checked={selImg ? selImg.spill : !!selBubble?.spill}
          onChange={e =>
            selected.kind === 'img'
              ? api.setImg(selected.index, { spill: e.target.checked })
              : api.setBubble(selected.index, { spill: e.target.checked })
          }
        />
        <span>Allow spill outside panel</span>
      </label>

      <div className="cb-ed-actions">
        <button
          type="button"
          className="cb-ed-btn"
          onClick={() => api.resetOne(selected.kind, selected.index)}
        >
          Reset
        </button>
        {selBubble && (
          <button
            type="button"
            className="cb-ed-btn cb-ed-btn-danger"
            title="Delete this bubble"
            onClick={() => api.deleteBubble(selected.index)}
          >
            Delete bubble
          </button>
        )}
      </div>

      <div className="cb-ed-hint">
        Drag to move · handle to {selected.kind === 'img' ? 'zoom' : 'resize/rotate'} ·
        {selected.kind === 'img' ? ' wheel zooms ·' : ''} arrows nudge (⇧×10) · +/− ·
        Esc deselects
      </div>
    </>
  )
}
