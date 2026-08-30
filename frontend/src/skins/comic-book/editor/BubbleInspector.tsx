import { TAIL_DIRS, TAIL_DIR_KEYS } from '../bubbleBox'
import type { TailDir } from '../bubbleBox'
import { isDialContent } from '../bubbleContent'
import type { BubbleContentKind } from '../bubbleContent'
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
 * the two morph targets and the hover weight — and its link.
 *
 * The link picker offers only the other bubbles on the same panel — that is where
 * the same-panel rule is enforced, by never presenting the invalid choice. Changing
 * the panel therefore clears a link that no longer makes sense, which `patchBubble`
 * does rather than this component.
 *
 * What is *not* here any more is the chain toggle. Being one SMS thread is no longer
 * something an author says about balloons after drawing them; it is what **+ SMS** makes,
 * whole, and the settings of the conversation a chained balloon belongs to are the
 * ChainInspector's below.
 */
export default function BubbleInspector({ api, index, bubble }: BubbleInspectorProps) {
  const candidates = linkCandidates(api.config.bubbles, index)
  const page = api.config.panels[bubble.panel]?.page

  return (
    <>
      <label className="cb-ed-field">
        <span>panel</span>
        <select
          className="cb-ed-select"
          value={bubble.panel}
          onChange={e => api.setBubble(index, { panel: Number(e.target.value) })}
        >
          {api.config.panels.map((p, i) =>
            p.page === page ? <option key={i} value={i}>{p.label}</option> : null,
          )}
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
          <option value="dial-call">Dial + call button</option>
          <option value="actions">Action buttons</option>
        </select>
      </label>
      <label className="cb-ed-field">
        <span>
          {bubble.content === 'wheel' || isDialContent(bubble.content)
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
      {isDialContent(bubble.content) && (
        <div className="cb-ed-hint">
          Comma-delimited, same as the wheel — but this is an autocomplete: the drum&apos;s
          centre line is a real phone field, and typing into it (or punching a number pad
          projected onto a picture on this panel) narrows the rows behind it. The first
          option is what it starts on; Enter dials, and adds the number to the list.
          {bubble.content === 'dial-call' && (
            <> The telephone&apos;s green key sits at the right of the field and places the
            same call Enter does. It stays greyed until the number in the field is one that
            could be dialled.</>
          )}
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
          Add a second bubble to {api.config.panels[bubble.panel]?.label ?? `panel ${bubble.panel}`}
          {' '}to link this one — a link joins two bubbles on the same panel.
        </div>
      )}

      {/* No chain checkbox. A conversation used to be assembled here — link two balloons,
          tick "scrollable chain", set the sender's content, tick "live SMS" — and every one
          of those was an ordinary edit that could be undone by accident, silently, leaving
          balloons that looked right and showed nothing. **+ SMS** in the toolbar is now the
          only way to make one, so the couplings are established together or not at all;
          what is left to edit is what an author actually wants to change, and it is in the
          conversation section below. */}
      {bubble.chain !== '' && (
        <div className="cb-ed-hint">
          This balloon is one column of a conversation — its settings are below. Its shape,
          tail, rotation and lettering are the template every row on this side is stamped
          from; its placement is where that side of the table sits.
        </div>
      )}
    </>
  )
}
