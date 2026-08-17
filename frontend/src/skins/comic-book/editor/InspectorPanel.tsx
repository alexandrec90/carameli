import { BUBBLE_TYPES, BUBBLE_TYPE_KEYS } from './bubbleTypes'
import type { BubbleType } from './bubbleTypes'
import type { EditorModeApi } from './useEditorMode'

interface InspectorPanelProps {
  api: EditorModeApi
  /** Human-readable name of the selected panel. */
  label: string
  /** Every panel's name, indexed like the config — for the link picker. */
  labels: string[]
}

/** Trim drag-produced floats to 2 decimals for the read-out (drops trailing zeros). */
function fmt(n: number): number {
  return Math.round(n * 100) / 100
}

/** Read a shape `<select>` back, mapping the empty "no change" option to null. */
function asType(value: string): BubbleType | null {
  return value === '' ? null : (value as BubbleType)
}

/**
 * Selection inspector: live numeric read-outs plus editable controls for the
 * currently selected image or bubble (spill toggle, and — for bubbles — type and
 * text), and a per-element reset. Rendered inside the toolbar by EditorOverlay only
 * when something is selected.
 */
export default function InspectorPanel({ api, label, labels }: InspectorPanelProps) {
  const { selected, config } = api
  if (!selected) return null

  const selImg = selected.kind === 'img' ? config.images[selected.index] : null
  const selBubble = selected.kind === 'bubble' ? config.bubbles[selected.index] : null

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

      {/* Bubble content controls */}
      {selBubble && (
        <>
          <label className="cb-ed-field">
            <span>type</span>
            <select
              className="cb-ed-select"
              value={selBubble.type}
              onChange={e =>
                api.setBubble(selected.index, { type: e.target.value as BubbleType })
              }
            >
              {BUBBLE_TYPE_KEYS.map(key => (
                <option key={key} value={key}>{BUBBLE_TYPES[key].label}</option>
              ))}
            </select>
          </label>
          <label className="cb-ed-field">
            <span>text</span>
            <textarea
              className="cb-ed-textarea"
              rows={2}
              value={selBubble.text}
              onChange={e => api.setBubble(selected.index, { text: e.target.value })}
            />
          </label>

          {/* Event morph targets. "no change" (null) means the bubble keeps its
              resting shape for that event, which is not the same as picking the
              resting shape here — that would still swap the lettering font. */}
          <label className="cb-ed-field">
            <span>on hover</span>
            <select
              className="cb-ed-select"
              value={selBubble.hoverType ?? ''}
              onChange={e =>
                api.setBubble(selected.index, { hoverType: asType(e.target.value) })
              }
            >
              <option value="">— no change —</option>
              {BUBBLE_TYPE_KEYS.map(key => (
                <option key={key} value={key}>{BUBBLE_TYPES[key].label}</option>
              ))}
            </select>
          </label>
          <label className="cb-ed-field">
            <span>on click</span>
            <select
              className="cb-ed-select"
              value={selBubble.clickType ?? ''}
              onChange={e =>
                api.setBubble(selected.index, { clickType: asType(e.target.value) })
              }
            >
              <option value="">— no change —</option>
              {BUBBLE_TYPE_KEYS.map(key => (
                <option key={key} value={key}>{BUBBLE_TYPES[key].label}</option>
              ))}
            </select>
          </label>

          {/* Connector tube. Symmetric, so it only needs declaring at one end; the
              tube redraws live as either bubble is dragged. */}
          <label className="cb-ed-field">
            <span>link to</span>
            <select
              className="cb-ed-select"
              value={selBubble.linkTo ?? ''}
              onChange={e =>
                api.setBubble(selected.index, {
                  linkTo: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            >
              <option value="">— none —</option>
              {labels.map((name, i) =>
                i === selected.index ? null : (
                  <option key={name} value={i}>{name}</option>
                ),
              )}
            </select>
          </label>
        </>
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

      <button
        type="button"
        className="cb-ed-btn"
        onClick={() => api.resetOne(selected.kind, selected.index)}
      >
        Reset
      </button>

      <div className="cb-ed-hint">
        Drag to move · handle to {selected.kind === 'img' ? 'zoom' : 'resize/rotate'} ·
        {selected.kind === 'img' ? ' wheel zooms ·' : ''} arrows nudge (⇧×10) · +/− ·
        Esc deselects
      </div>
    </>
  )
}
