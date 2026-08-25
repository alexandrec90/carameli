import {
  CHAIN_STEP_MS, chainSlots, chainTranscript, defaultChain, isComposerContent, messageSlots,
} from '../bubbleChain'
import { parseMessages } from './chainOps'
import type { BubbleTransform } from './types'
import type { EditorModeApi } from './useEditorMode'

interface ChainInspectorProps {
  api: EditorModeApi
  /** Index of the selected bubble, into `api.config.bubbles`. */
  index: number
  /** The selected bubble — chained, or this component is not rendered. */
  bubble: BubbleTransform
}

/**
 * The chain half of the bubble inspector: the settings for the *thread* the selected
 * balloon is a slot of, shown below the balloon's own fields whenever it is in a chain.
 *
 * There is no chain picker, no add button and no delete button, because the list is
 * derived — a chain exists exactly while some linked group is ticked as one (see
 * syncChains and propagateChains). What this edits is the behaviour of one that already
 * exists, plus the transcript that runs through it. Scrolling is not among the settings:
 * a chain *is* a window over a transcript, so the wheel always moves it.
 */
export default function ChainInspector({ api, index, bubble }: ChainInspectorProps) {
  const { bubbles } = api.config
  const chain = api.config.chains.find(c => c.id === bubble.chain) ?? defaultChain(bubble.chain)
  const slots = chainSlots(bubbles, bubble.chain, bubble.panel)
  const slot = slots.indexOf(index)
  const root = slots.length > 0 ? bubbles[slots[0]] : undefined
  const live = root !== undefined && isComposerContent(root.content)
  const holders = messageSlots(slots.length, live)
  const total = chainTranscript(chain, slots.map(i => bubbles[i].text)).length

  return (
    <>
      <div className="cb-ed-label">Chain of {slots.length} balloon{slots.length === 1 ? '' : 's'}</div>
      <div className="cb-ed-hint">
        {slot === 0
          ? live
            ? `Root — slot 1 of ${slots.length}. Its content is a field, so this is the composer: what a reader types here lands in the thread and the column grows upward from it.`
            : `Root — slot 1 of ${slots.length}. The tail comes out of this one, it holds the newest message, and older ones climb the column above it.`
          : `Slot ${slot + 1} of ${slots.length}, counting up from the root, holding the message ${slot === 1 ? 'before it' : `${slot} back`}. Drag it past a neighbour to reorder the column.`}
      </div>

      <label className="cb-ed-check">
        <input
          type="checkbox"
          checked={chain.grow}
          onChange={e => api.setChain(chain.id, { grow: e.target.checked })}
        />
        <span>Grow in one balloon at a time</span>
      </label>

      {chain.grow && !live && (
        <label className="cb-ed-field">
          <span>step ms</span>
          <input
            className="cb-ed-input"
            type="number"
            min={CHAIN_STEP_MS.min}
            max={CHAIN_STEP_MS.max}
            step={CHAIN_STEP_MS.step}
            value={chain.stepMs}
            onChange={e => api.setChain(chain.id, { stepMs: Number(e.target.value) })}
          />
        </label>
      )}

      <label className="cb-ed-field">
        <span>messages</span>
        <textarea
          className="cb-ed-textarea"
          rows={4}
          value={chain.messages.join('\n')}
          placeholder="One message per line — leave empty to use each balloon's own text"
          onChange={e => api.setChain(chain.id, { messages: parseMessages(e.target.value) })}
        />
      </label>
      <div className="cb-ed-hint">
        {total} message{total === 1 ? '' : 's'} through {holders} balloon
        {holders === 1 ? '' : 's'}
        {live ? ' (the root is the composer)' : ''}
        {total > holders ? ' — the wheel scrolls the rest into view.' : '.'}
      </div>
      {live && (
        <div className="cb-ed-hint">
          Outside edit mode this chain starts at the composer alone and grows by one
          balloon per message, up to the {slots.length} drawn — after that each new message
          pushes the oldest visible one off the top.
        </div>
      )}

      <div className="cb-ed-actions">
        <button
          type="button"
          className="cb-ed-btn"
          onClick={() => api.addChainSlot(bubble.panel, chain.id)}
        >
          + Balloon in chain
        </button>
      </div>
    </>
  )
}
