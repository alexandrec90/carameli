import { TAIL_DIRS, TAIL_DIR_KEYS } from '../bubbleBox'
import type { TailDir } from '../bubbleBox'
import { BUBBLE_TYPES, BUBBLE_TYPE_KEYS } from './bubbleTypes'
import type { BubbleType } from './bubbleTypes'
import { linkCandidates } from './configOps'
import type { BubbleTransform } from './types'
import type { EditorModeApi } from './useEditorMode'

interface BubbleInspectorProps {
  api: EditorModeApi
  /** Index of the selected bubble, into `api.config.bubbles`. */
  index: number
  /** The selected bubble itself. */
  bubble: BubbleTransform
  /** Every panel's name, indexed like PANEL_IMAGES — for the panel picker. */
  labels: string[]
}

/** Read a shape `<select>` back, mapping the empty "no change" option to null. */
function asType(value: string): BubbleType | null {
  return value === '' ? null : (value as BubbleType)
}

/** Identify a bubble in the link picker by what it says, since its panel is a given. */
function bubbleLabel(b: BubbleTransform, i: number): string {
  const text = b.text.trim()
  const short = text.length > 24 ? `${text.slice(0, 23)}…` : text
  return short ? `${i}: ${short}` : `${i}: (no text)`
}

/**
 * The bubble-only half of the selection inspector: which panel it belongs to, its
 * shape and tail, its text, the event morph targets, and its connector link.
 *
 * The link picker offers only the other bubbles on the same panel — that is where
 * the same-panel rule is enforced, by never presenting the invalid choice. Changing
 * the panel therefore clears a link that no longer makes sense, which `patchBubble`
 * does rather than this component.
 */
export default function BubbleInspector({ api, index, bubble, labels }: BubbleInspectorProps) {
  const candidates = linkCandidates(api.config.bubbles, index)

  return (
    <>
      <label className="cb-ed-field">
        <span>panel</span>
        <select
          className="cb-ed-select"
          value={bubble.panel}
          onChange={e => api.setBubble(index, { panel: Number(e.target.value) })}
        >
          {labels.map((name, i) => (
            <option key={name} value={i}>{name}</option>
          ))}
        </select>
      </label>
      <label className="cb-ed-field">
        <span>type</span>
        <select
          className="cb-ed-select"
          value={bubble.type}
          onChange={e => api.setBubble(index, { type: e.target.value as BubbleType })}
        >
          {BUBBLE_TYPE_KEYS.map(key => (
            <option key={key} value={key}>{BUBBLE_TYPES[key].label}</option>
          ))}
        </select>
      </label>
      <label className="cb-ed-field">
        <span>tail</span>
        <select
          className="cb-ed-select"
          value={bubble.tail}
          onChange={e => api.setBubble(index, { tail: e.target.value as TailDir })}
        >
          {TAIL_DIR_KEYS.map(key => (
            <option key={key} value={key}>{TAIL_DIRS[key].label}</option>
          ))}
        </select>
      </label>
      <label className="cb-ed-field">
        <span>text</span>
        <textarea
          className="cb-ed-textarea"
          rows={2}
          value={bubble.text}
          onChange={e => api.setBubble(index, { text: e.target.value })}
        />
      </label>

      {/* Event morph targets. "no change" (null) means the bubble keeps its
          resting shape for that event, which is not the same as picking the
          resting shape here — that would still swap the lettering font. */}
      <label className="cb-ed-field">
        <span>on hover</span>
        <select
          className="cb-ed-select"
          value={bubble.hoverType ?? ''}
          onChange={e => api.setBubble(index, { hoverType: asType(e.target.value) })}
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
          value={bubble.clickType ?? ''}
          onChange={e => api.setBubble(index, { clickType: asType(e.target.value) })}
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
          value={bubble.linkTo ?? ''}
          disabled={candidates.length === 0}
          onChange={e =>
            api.setBubble(index, {
              linkTo: e.target.value === '' ? null : Number(e.target.value),
            })
          }
        >
          <option value="">— none —</option>
          {candidates.map(i => (
            <option key={i} value={i}>{bubbleLabel(api.config.bubbles[i], i)}</option>
          ))}
        </select>
      </label>
      {candidates.length === 0 && (
        <div className="cb-ed-hint">
          Add a second bubble to {labels[bubble.panel]} to link this one — a tube joins
          two bubbles on the same panel.
        </div>
      )}
    </>
  )
}
