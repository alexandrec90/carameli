import {
  CHAIN_ROWS, CHAIN_STEP_MS, chainMembers, chainTranscript, defaultChain, isComposerContent,
  messageRows, peerPickerOn, readTranscript,
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
 * The chain half of the bubble inspector: the settings for the *conversation* the selected
 * balloon is a column of, shown below the balloon's own fields whenever it is in a chain.
 *
 * There is no chain picker and no delete button, because the list is derived — a chain
 * exists exactly while some linked group is ticked as one (see syncChains and
 * propagateChains). What this edits is the behaviour of one that already exists, plus the
 * transcript that runs through it. Scrolling is not among the settings: a chain *is* a
 * window over a transcript, so the wheel always moves it.
 */
export default function ChainInspector({ api, index, bubble }: ChainInspectorProps) {
  const { bubbles } = api.config
  const chain = api.config.chains.find(c => c.id === bubble.chain) ?? defaultChain(bubble.chain)
  const members = chainMembers(bubbles, bubble.chain, bubble.panel)
  // Member 0 is the rightmost balloon, which is the sender's column by definition.
  const mine = members.indexOf(index) === 0
  const sender = members.length > 0 ? bubbles[members[0]] : undefined
  const live = sender !== undefined && isComposerContent(sender.content)
  const holders = messageRows(chain.rows, live)
  const lines = readTranscript(chainTranscript(chain, members.map(i => bubbles[i])))
  const total = lines.length
  const out = lines.filter(l => l.out).length
  // Whether the panel offers a number to bind to. Checked here rather than left to fail
  // silently at render time: a bound chain with no picker draws an empty table, which
  // looks like a broken chain and is actually a missing balloon.
  const hasPicker = peerPickerOn(bubbles, bubble.panel) >= 0

  return (
    <>
      <div className="cb-ed-label">
        {members.length > 1 ? 'Conversation' : 'Conversation (one column so far)'}
      </div>
      <div className="cb-ed-hint">
        {mine
          ? live
            ? 'The sender — the right column. Its content is a field, so the bottom row is the composer: what a reader types there is sent as this side’s next message.'
            : 'The sender — the right column. Give it `input` content to turn the bottom row into a composer a reader can type into.'
          : 'The recipient — the left column.'}{' '}
        Every row of that side is stamped from this balloon: its shape, tail, rotation and
        lettering, at a width that follows the message. Drag it past its partner to swap the
        two columns over.
      </div>

      <label className="cb-ed-field">
        <span>rows</span>
        <input
          className="cb-ed-input"
          type="number"
          min={CHAIN_ROWS.min}
          max={CHAIN_ROWS.max}
          step={CHAIN_ROWS.step}
          value={chain.rows}
          onChange={e => api.setChain(chain.id, { rows: Number(e.target.value) })}
        />
      </label>

      <label className="cb-ed-check">
        <input
          type="checkbox"
          checked={chain.grow}
          onChange={e => api.setChain(chain.id, { grow: e.target.checked })}
        />
        <span>Grow in one message at a time</span>
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

      <label className="cb-ed-check">
        <input
          type="checkbox"
          checked={chain.sms}
          onChange={e => api.setChain(chain.id, { sms: e.target.checked })}
        />
        <span>Live SMS conversation</span>
      </label>
      {chain.sms && (
        <div className="cb-ed-hint">
          {hasPicker
            ? 'Bound to whichever number this panel’s wheel picker is turned to. The transcript below is not drawn — the balloons are the real messages — and Enter in the composer sends one for money.'
            : 'This panel has no wheel-picker balloon, so there is no number to bind to and the conversation renders empty. Add a bubble with `wheel` content, outside the chain, whose text is the numbers separated by commas.'}
        </div>
      )}

      <label className="cb-ed-field">
        <span>messages</span>
        <textarea
          className="cb-ed-textarea"
          rows={6}
          value={chain.messages.join('\n')}
          placeholder={'One message per line, oldest first.\nStart a line with > for the sender’s side.'}
          onChange={e => api.setChain(chain.id, { messages: parseMessages(e.target.value) })}
        />
      </label>
      <div className="cb-ed-hint">
        {total} message{total === 1 ? '' : 's'} — {out} sent, {total - out} received — through{' '}
        {holders} row{holders === 1 ? '' : 's'}
        {live ? ' (the bottom row is the composer)' : ''}
        {total > holders ? ' — the wheel scrolls the rest into view.' : '.'}
      </div>
      {live && (
        <div className="cb-ed-hint">
          Outside edit mode this conversation starts at the composer alone and grows by one
          row per message, up to the {chain.rows} it holds — after that each new message
          pushes the oldest visible one off the top.
        </div>
      )}

      {members.length < 2 && (
        <div className="cb-ed-actions">
          <button
            type="button"
            className="cb-ed-btn"
            onClick={() => api.addChainColumn(bubble.panel, chain.id)}
          >
            + Other column
          </button>
        </div>
      )}
    </>
  )
}
