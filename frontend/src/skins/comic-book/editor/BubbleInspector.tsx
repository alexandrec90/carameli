import { TAIL_DIRS, TAIL_DIR_KEYS } from '../bubbleBox'
import type { TailDir } from '../bubbleBox'
import type { BubbleContentKind } from '../bubbleContent'
import { PANELS } from '../panels'
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
 * shape and tail, how its text is presented, the text itself, the event responses —
 * the two morph targets and the hover weight — its link, and whether the linked group
 * is a chain.
 *
 * The link picker offers only the other bubbles on the same panel — that is where
 * the same-panel rule is enforced, by never presenting the invalid choice. Changing
 * the panel therefore clears a link that no longer makes sense, which `patchBubble`
 * does rather than this component.
 *
 * Those two controls are deliberately adjacent, because together they are the whole of
 * "these balloons are one SMS thread": the picker says *which* balloons, the checkbox says
 * what the group of them is. A chain used to be a name typed into a third field, which
 * meant the author could say it twice and disagree with themselves.
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
          <option value="input">Text input</option>
          <option value="phone">Phone input</option>
          <option value="dial">Dial (wheel + phone input)</option>
          <option value="actions">Action buttons</option>
        </select>
      </label>
      <label className="cb-ed-field">
        <span>
          {bubble.content === 'wheel' || bubble.content === 'dial'
            ? 'options'
            : bubble.content === 'input' || bubble.content === 'phone'
              ? 'initial value'
              : bubble.content === 'actions'
                ? 'buttons'
                : 'text'}
        </span>
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
      {bubble.content === 'dial' && (
        <div className="cb-ed-hint">
          Comma-delimited, same as the wheel — but this is an autocomplete: the drum&apos;s
          centre line is a real phone field, and typing into it (or punching a number pad
          projected onto a picture on this panel) narrows the rows behind it. The first
          option is what it starts on; Enter dials, and adds the number to the list.
        </div>
      )}
      {(bubble.content === 'input' || bubble.content === 'phone') && (
        <div className="cb-ed-hint">
          This becomes an editable field outside edit mode. Phone input formats while
          typing from the browser locale; a leading + always uses that country code.
        </div>
      )}
      {bubble.content === 'actions' && (
        <div className="cb-ed-hint">
          Comma-delimited: each entry is one placeholder button. They press but are
          wired to nothing yet.
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

      {/* The third event response, and the one that is not a morph: weight is a stroke,
          so it is a checkbox rather than a fourth entry in the shape list. It bolds this
          balloon alone — a tube and the balloon at its far end keep their own ink. */}
      <label className="cb-ed-check">
        <input
          type="checkbox"
          checked={bubble.hoverBold}
          onChange={e => api.setBubble(index, { hoverBold: e.target.checked })}
        />
        <span>Bolder outline on hover</span>
      </label>

      {/* Connector tube — and, with the checkbox below, the chain. Symmetric, so it only
          needs declaring at one end; the tube redraws live as either bubble is dragged. */}
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
          Add a second bubble to {PANELS[bubble.panel]?.label ?? `panel ${bubble.panel}`}
          {' '}to link this one — a link joins two bubbles on the same panel.
        </div>
      )}

      {/* The chain toggle. Applied to the whole linked group rather than to this balloon,
          because a thread is a property of the column: ticking it here chains everything
          reachable through the links above, and unticking it takes the whole column back
          to plain balloons. That is why it is a checkbox and not a name — the author has
          already said which balloons belong together by linking them. */}
      <label className="cb-ed-check">
        <input
          type="checkbox"
          checked={bubble.chain !== ''}
          onChange={e => api.setChained(index, e.target.checked)}
        />
        <span>Scrollable chain</span>
      </label>
      <div className="cb-ed-hint">
        {bubble.chain
          ? `The linked balloons are one thread: messages run through them, the wheel moves
             the window, and no tubes are drawn between them.`
          : `Link balloons into a column, then tick this on any of them to read the column
             as one SMS thread instead of as tube-joined balloons.`}
      </div>
    </>
  )
}
