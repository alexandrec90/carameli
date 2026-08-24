import { TAIL_DIRS, TAIL_DIR_KEYS } from '../bubbleBox'
import type { TailDir } from '../bubbleBox'
import { chainIds } from '../bubbleChain'
import { PANELS } from '../panels'
import type { BubbleContentKind } from '../wheelPicker'
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
 * shape and tail, how its text is presented, the text itself, the event morph
 * targets, and its connector link.
 *
 * The link picker offers only the other bubbles on the same panel — that is where
 * the same-panel rule is enforced, by never presenting the invalid choice. Changing
 * the panel therefore clears a link that no longer makes sense, which `patchBubble`
 * does rather than this component.
 */
export default function BubbleInspector({ api, index, bubble }: BubbleInspectorProps) {
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
          {PANELS.map((p, i) => (
            <option key={p.label} value={i}>{p.label}</option>
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
        <span>content</span>
        <select
          className="cb-ed-select"
          value={bubble.content}
          onChange={e => api.setBubble(index, { content: e.target.value as BubbleContentKind })}
        >
          <option value="text">Text</option>
          <option value="wheel">Wheel picker</option>
        </select>
      </label>
      <label className="cb-ed-field">
        <span>{bubble.content === 'wheel' ? 'options' : 'text'}</span>
        <textarea
          className="cb-ed-textarea"
          rows={2}
          value={bubble.text}
          onChange={e => api.setBubble(index, { text: e.target.value })}
        />
      </label>
      {bubble.content === 'wheel' && (
        <div className="cb-ed-hint">
          Comma-delimited: each entry is one option on the wheel. Hover the bubble and
          scroll to turn it — the picker is live outside edit mode.
        </div>
      )}

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

      {/* Chain membership. A free-text name rather than a picker: naming a chain is how
          one comes into existence, so there is nothing to pick from until there is. The
          list of names already in use is offered as completions so the second balloon of
          a thread is one keystroke, not a chance to typo the first one's name. */}
      <label className="cb-ed-field">
        <span>chain</span>
        <input
          className="cb-ed-input"
          list="cb-ed-chain-names"
          value={bubble.chain}
          placeholder="— none —"
          onChange={e => api.setBubble(index, { chain: e.target.value })}
        />
      </label>
      <datalist id="cb-ed-chain-names">
        {chainIds(api.config.bubbles).map(id => (
          <option key={id} value={id} />
        ))}
      </datalist>

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
          {bubble.chain
            ? `A chained bubble takes no tube: its slot holds whatever message has scrolled
               into it, so a tube would join a different sentence each time. Clear the chain
               name to link it.`
            : `Add a second bubble to ${PANELS[bubble.panel]?.label ?? `panel ${bubble.panel}`}
               to link this one — a tube joins two bubbles on the same panel.`}
        </div>
      )}
    </>
  )
}
