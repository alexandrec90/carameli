import { mirrorTailDir } from '../bubbleBox'
import { DEFAULT_CHAIN_ROWS, mirrorColumn } from '../bubbleChain'
import { nextChainId, patchChainIn } from './chainOps'
import { cloneConfig, NEW_PEER_PICKER, NEW_SMS_SENDER } from './configSeed'
import { reconcile } from './reconcile'
import type { EditorConfig } from './types'

// Building a conversation, as one op rather than as six edits the author has to get right
// in order.
//
// A live SMS conversation used to be assembled by hand: add a balloon, add a second, link
// them, tick "scrollable chain", give the first one `input` content, tick "live SMS", then
// find the panel's picker. Six couplings, none of them visible in the result, and any one
// ordinary inspector edit silently took the conversation apart again — which is the
// complaint this module exists to answer. There is now one button, and the settings it
// cannot infer (how many rows, where the two columns sit) are the only ones left to edit.

/**
 * Add a whole SMS conversation to `panel`: the two root balloons its rows are stamped
 * from, already linked, already one chain, already bound to the carrier.
 *
 * Two balloons and no more, because a conversation *is* two columns — the sender's and the
 * recipient's — and every row on screen is one of them restamped. They are **linked**
 * rather than merely given the same chain id: linkage is what a chain is made of, so a
 * pair joined any other way would come apart the next time {@link reconcile} settled the
 * ids from the graph.
 *
 * The recipient is the sender mirrored across the panel, tail turned back the way it came,
 * saying nothing — the same rule `addChainColumn` uses, and for the same reason: an SMS
 * conversation's two sides are the same balloon on opposite edges, and cloning the
 * composer's own content onto the other side would put the sender's words in the
 * recipient's mouth.
 *
 * `sms: true` is set here rather than offered as a checkbox: the button says "SMS
 * conversation", so binding it to the account's real thread is what was asked for. Nothing
 * is spent by asking — a chain never binds in edit mode (see PanelBubbles) — and what the
 * panel still owes the conversation is a number, which is {@link addPeerPicker}'s job.
 *
 * Returns the *sender's* index: it is the balloon the table hangs from (rows stack upward
 * from it), and its inspector is where the conversation's own settings live.
 */
export function addSmsConversation(
  config: EditorConfig,
  panel: number,
): { config: EditorConfig; index: number } {
  const next = cloneConfig(config)
  const id = nextChainId(next.bubbles)
  const senderIndex = next.bubbles.length
  const sender = { ...NEW_SMS_SENDER, panel, chain: id }
  next.bubbles.push(sender)
  next.bubbles.push({
    ...mirrorColumn(sender),
    tail: mirrorTailDir(sender.tail),
    content: 'text',
    text: '',
    linkTo: senderIndex,
  })
  const settled = reconcile(next)
  // The entry exists by now — `syncChains` created it from the id the two balloons carry —
  // so this is a patch and not an insert, which is the only shape the derived list allows.
  settled.chains = patchChainIn(settled.chains, id, {
    sms: true,
    rows: DEFAULT_CHAIN_ROWS,
    messages: [],
  })
  return { config: settled, index: senderIndex }
}

/**
 * Add the balloon that says *who* a panel's conversations are with: a dial — a phone field
 * with a shortlist behind it — outside every chain, which `peerPickerOn` reads a number
 * off.
 *
 * Separate from {@link addSmsConversation} because it is separate on the panel: one picker
 * serves however many conversations are drawn there, and a second one would be ignored.
 * The chain inspector offers this only while the panel has none.
 */
export function addPeerPicker(
  config: EditorConfig,
  panel: number,
): { config: EditorConfig; index: number } {
  const next = cloneConfig(config)
  next.bubbles.push({ ...NEW_PEER_PICKER, panel })
  return { config: reconcile(next), index: next.bubbles.length - 1 }
}
