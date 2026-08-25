import { CHAIN_STEP_MS, chainSlots, chainTranscript, defaultChain } from '../bubbleChain'
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
 * balloon is a slot of, shown below the balloon's own fields whenever it names a chain.
 *
 * There is no chain picker and no delete button, because the list is derived — a chain
 * exists exactly while some balloon names it (see syncChains). What this edits is the
 * behaviour of one that already exists, plus the transcript that runs through it.
 */
export default function ChainInspector({ api, index, bubble }: ChainInspectorProps) {
  const { bubbles } = api.config
  const chain = api.config.chains.find(c => c.id === bubble.chain) ?? defaultChain(bubble.chain)
  const slots = chainSlots(bubbles, bubble.chain, bubble.panel)
  const slot = slots.indexOf(index)
  const total = chainTranscript(chain, slots.map(i => bubbles[i].text)).length

  return (
    <>
      <div className="cb-ed-label">Chain “{chain.id}”</div>
      <div className="cb-ed-hint">
        {slot === 0
          ? `Root — slot 1 of ${slots.length}. The tail comes out of this one and the thread grows upward from it.`
          : `Slot ${slot + 1} of ${slots.length}, counting up from the root. Drag it past a neighbour to reorder the column.`}
      </div>

      <label className="cb-ed-check">
        <input
          type="checkbox"
          checked={chain.grow}
          onChange={e => api.setChain(chain.id, { grow: e.target.checked })}
        />
        <span>Grow in one balloon at a time</span>
      </label>
      <label className="cb-ed-check">
        <input
          type="checkbox"
          checked={chain.scroll}
          onChange={e => api.setChain(chain.id, { scroll: e.target.checked })}
        />
        <span>Scroll with the wheel</span>
      </label>

      {chain.grow && (
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
        {total} message{total === 1 ? '' : 's'} through {slots.length} balloon
        {slots.length === 1 ? '' : 's'}
        {total > slots.length
          ? chain.scroll
            ? ' — the rest scroll into view.'
            : ' — turn on scrolling, or the oldest are unreachable.'
          : '.'}
      </div>

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
