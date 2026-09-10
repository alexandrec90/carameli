import {
  CHAIN_ROWS, chainMembers, chainTranscript, defaultChain, isComposerContent,
  messageRows, peerPickerOn, readTranscript,
} from '../bubbleChain'
import { BOUND_HINT, columnHint, rowsHint, transcriptSummary } from './chainHints'
import { parseMessages } from './chainOps'
import Hint from './Hint'
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
 * exists exactly while some linked group carries an id (see syncChains and
 * propagateChains), which **+ SMS** in the toolbar is now the only thing that arranges.
 *
 * What is left here is what an author has an actual reason to change: how many **rows** the
 * table holds, and — on a chain that is not bound to a real thread — the transcript that
 * runs through it. Everything else that used to sit here was a switch that could take a
 * working conversation apart with one click and give no sign that it had: scrolling
 * (a chain *is* a window over a transcript, so the wheel always moves it), the growth
 * animation and its delay, and the live-SMS binding itself.
 *
 * Where the table *lands* is not a field either, and deliberately: it is the two balloons'
 * own placement, drawn on the panel as a dashed frame (see chainFrame.ts) so that dragging
 * them and setting `rows` have a visible result. That frame is the answer to the editor
 * and the running page disagreeing about where a conversation is.
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
        {mine ? 'The sender — the right column.' : 'The recipient — the left column.'}{' '}
        <Hint text={columnHint(mine, live)} />
      </div>

      <div className="cb-ed-row">
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
        <Hint text={rowsHint(live)} />
      </div>

      {/* No "live SMS" checkbox, and no growth controls. A conversation added with **+ SMS**
          is bound already — that is what the button means — and how it plays is the
          renderer's business. What is left here is what an author has a reason to change. */}
      {/* The bound case says its piece in a `?`; the *unbound* one stays a block, because
          it is a fault an author has to act on — the conversation renders empty outside
          edit mode until the button below is pressed, and a warning nobody hovers is a
          warning nobody reads. */}
      {chain.sms && hasPicker && (
        <div className="cb-ed-hint">
          Bound to this panel&apos;s picker <Hint text={BOUND_HINT} />
        </div>
      )}
      {chain.sms && !hasPicker && (
        <div className="cb-ed-hint">
          This panel has no picker balloon, so there is no number to bind to and the
          conversation renders empty outside edit mode. Add one below.
        </div>
      )}
      {chain.sms && !hasPicker && (
        <div className="cb-ed-actions">
          <button
            type="button"
            className="cb-ed-btn"
            onClick={() => api.addPeerPickerOn(bubble.panel)}
          >
            + Number picker
          </button>
        </div>
      )}

      {/* An authored transcript, on a chain that has one. A bound chain does not: its
          balloons are the account's real messages, so a textarea here would be a field the
          author can type into and never see again — which is the editor disagreeing with
          what runs, in the one place that costs money to discover. */}
      {!chain.sms && (
        <>
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
          <div className="cb-ed-hint">{transcriptSummary(total, out, holders, live)}</div>
        </>
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
