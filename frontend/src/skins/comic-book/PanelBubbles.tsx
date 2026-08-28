import { Fragment, useCallback, useEffect, useState } from 'react'

import { chainIdsOn, chainMembers, defaultChain, peerPickerOn } from './bubbleChain'
import type { BubbleChain } from './bubbleChain'
import PanelBubble from './PanelBubble'
import PanelBubbleChain from './PanelBubbleChain'
import type { BubbleTransform } from './editor/types'
import type { PhoneActionHandlers } from './phoneActions'
import { browserCountry, toE164 } from './phoneInput'
import type { UseSmsConversationsResult } from '../../hooks/useSmsConversations'
import type { SmsConversationMessage } from '../../lib/smsConversation'

/**
 * One shared "nothing yet" array. A chain whose first poll has not landed is handed this
 * rather than a fresh `[]` per render, so its transcript keeps the same identity and the
 * balloons do not remount underneath a conversation that has not changed.
 */
const NO_MESSAGES: readonly SmsConversationMessage[] = []

/**
 * The same, for a panel with nothing dialled yet: the dial's shortlist is memoized on
 * this array's identity, so a fresh `[]` per render would rebuild it every time.
 */
const EMPTY_DIALLED: string[] = []

interface PanelBubblesProps {
  /** Every bubble on the page — `panel` decides which ones this panel draws. */
  bubbles: BubbleTransform[]
  /** Chain settings, one per chain name the bubbles carry. */
  chains: BubbleChain[]
  /** Index of the panel being drawn, into PANELS. */
  panel: number
  /** CSS clip-path of the panel polygon, for bubbles that don't spill. */
  clip: string
  /** Whether bubble `index` (into `bubbles`) is currently revealed. */
  isVisible(index: number): boolean
  /** False in edit mode: the editor overlay owns the pointer there. */
  interactive: boolean
  /**
   * True in edit mode. Chains are then drawn *flat* — each template at its own placement,
   * saying its own words — instead of being played as a conversation. The editor selects
   * and drags a balloon by hit-testing its transform, so a template the conversation had
   * stamped rows from, and drawn nowhere itself, would be a balloon the author cannot
   * reach.
   */
  editing: boolean
  /**
   * The page's live SMS, from the hook App owns. Nothing here fetches: this panel says
   * which conversation it is showing and reads what comes back, which is the skin rule
   * (`.claude/rules/skin-architecture.md`) applied to chrome that has no view to get
   * props from.
   */
  sms: UseSmsConversationsResult
  /**
   * Dials what a reader typed into a `phone` balloon and pressed Enter on, making that
   * balloon the number pad's fallback: somewhere to type a number on a page whose picture
   * has no keypad on it, or when the projected keys are awkward to hit.
   *
   * `input` balloons are free text and never dial. A balloon inside a chain never dials
   * either — its Enter belongs to the conversation's composer (see PanelBubbleChain) —
   * which the claimed-index filter below already guarantees.
   *
   * A `dial` balloon dials on Enter too, and for the same reason: it is a phone field
   * with a shortlist behind it.
   */
  onPhoneSubmit?(value: string): void
  /**
   * The panel's dialled number and the way to change it, both owned by ComicPanel — the
   * one place that can see this panel's `dial` balloons *and* the keypad projected onto
   * its pictures, which write to the same value. Absent on a panel with no dial.
   */
  dialValue?: string
  /** Whether that number is drum-supplied and so replaced, not appended to, by the next key. */
  dialFresh?: boolean
  onDialChange?(value: string, fresh: boolean): void
  /**
   * Numbers dialled from this panel, appended to a `dial` balloon's authored shortlist so
   * the drum grows into a redial list. The panel's, like the value, and for the same
   * reason: a number punched into the picture is dialled from the panel, not the balloon.
   */
  dialled?: string[]
  /**
   * What the telephone's keys do, for any `actions` balloon on this panel. Absent in the
   * editor and on a page with no telephone: the keys are drawn there and do nothing.
   */
  phoneActions?: PhoneActionHandlers
}

/**
 * The bubbles belonging to one panel. A panel may own several or none — the array is
 * filtered by `panel` rather than indexed by it, so adding a bubble in the editor is
 * an append and never has to line up with anything.
 *
 * Each bubble is placed against this panel's box by `bubbleStyle`, so it must render
 * inside the panel element even when `spill` lets its ink cross the panel edge; that
 * is why this is a fragment of siblings and not its own positioned layer.
 *
 * Bubbles naming a `chain` are pulled out of that flat list and handed to
 * PanelBubbleChain as the two templates of one SMS conversation — a table of balloons that
 * grows in and scrolls. Everything else renders exactly as it always did, which is what
 * makes chains a per-conversation opt-in rather than a change to how bubbles work.
 *
 * **This is also where a chain stops being a drawing.** A chain whose `sms` flag is set is
 * bound to the number the panel's picker balloon carries (`peerPickerOn`) — a wheel turned
 * to a row, or a dial typed into — and from then
 * on its balloons are messages the carrier has: what the author typed into the templates is
 * not shown, and Enter in the composer sends. The two halves are deliberately separate
 * bubbles — the picker says *who*, the chain says *what* — because that is how the panel
 * reads as a phone rather than as a form.
 */
export default function PanelBubbles({
  bubbles,
  chains,
  panel,
  clip,
  isVisible,
  interactive,
  editing,
  sms,
  onPhoneSubmit,
  dialValue = '',
  dialFresh = false,
  onDialChange,
  dialled = EMPTY_DIALLED,
  phoneActions,
}: PanelBubblesProps) {
  const ids = editing ? [] : chainIdsOn(bubbles, panel)
  const conversations = ids.map(id => ({
    id,
    members: chainMembers(bubbles, id, panel),
    chain: chains.find(c => c.id === id) ?? defaultChain(id),
  }))
  // Indices the conversations have claimed, so the flat pass below skips them.
  const claimed = new Set(conversations.flatMap(c => c.members))

  // The balloon whose options are phone numbers, or -1 on a panel with no picker.
  const pickerIndex = peerPickerOn(bubbles, panel)
  // A dial picker reports nothing: its number is the panel's, because the keypad in the
  // picture writes to it too. So the number a chain binds to comes from the prop rather
  // than from the local selection below, and the two are never both in play.
  const dialPicker = pickerIndex >= 0 && bubbles[pickerIndex].content === 'dial'
  // Whichever option the drum is showing. Reported by BubbleWheel on mount as well as on
  // every turn, so this is populated before the reader touches anything.
  const [picked, setPicked] = useState('')
  // Stable, because BubbleWheel reports through an effect and would re-report on every
  // render of this panel otherwise — which is a render of this panel, forever.
  const onWheelSelect = useCallback((value: string) => setPicked(value), [])

  // Whether anything on this panel actually wants a thread. A picker is an ordinary
  // balloon on most panels, and resolving a number off one is not a reason to poll a
  // carrier — only a chain asking to be bound is.
  const wanted = conversations.some(c => c.chain.sms)

  // The option as an API takes it. Null when nothing asked, when the panel has no picker,
  // when the editor is up, or when the option is not a phone number at all — a picker
  // whose options are names is an ordinary comic balloon and binds nothing.
  //
  // Deliberately not memoized: the value is a string or null, so it is stable *by value*
  // and the effect below re-runs only when the number really changes. A `useMemo` here
  // bought nothing and the compiler could not preserve it anyway, because `browserCountry`
  // reads `navigator` rather than a tracked dependency.
  const chosen = dialPicker ? dialValue : picked
  const peer = !wanted || editing || !chosen ? null : toE164(chosen, browserCountry())

  // Declaring interest is the whole of what a skin does about data. The hook polls while
  // somebody is subscribed and stops when the last one leaves, so turning the wheel to
  // another number drops the old conversation on the same tick it picks up the new one.
  const { subscribe } = sms
  useEffect(() => {
    if (!peer) return
    return subscribe(peer)
  }, [peer, subscribe])

  return (
    <>
      {bubbles.map((bubble, i) => {
        if (bubble.panel !== panel || claimed.has(i)) return null
        const el = (
          <PanelBubble
            bubble={bubble}
            visible={isVisible(i)}
            interactive={interactive}
            onWheelSelect={i === pickerIndex ? onWheelSelect : undefined}
            onSubmit={
              bubble.content === 'phone' || bubble.content === 'dial'
                ? onPhoneSubmit
                : undefined
            }
            dialValue={dialValue}
            dialFresh={dialFresh}
            dialled={dialled}
            onDialChange={onDialChange}
            actions={bubble.content === 'actions' ? phoneActions : undefined}
          />
        )
        // spill off: a clip wrapper hides the overflow behind the panel edge.
        return bubble.spill ? (
          <Fragment key={i}>{el}</Fragment>
        ) : (
          <div key={i} className="cb-bubble-clip" style={{ clipPath: clip }}>
            {el}
          </div>
        )
      })}
      {conversations.map(({ id, members, chain }) => {
        // Bound only when the author asked for it *and* the panel resolved a number. A
        // chain that asked and got nothing shows an empty conversation rather than falling
        // back to the authored transcript: the fallback would put words in a real thread.
        const live = chain.sms && peer !== null
        const table = (
          <PanelBubbleChain
            chain={chain}
            members={members.map(i => bubbles[i])}
            // Every member of a chain belongs to this panel, so they reveal and hide
            // together; the sender template's answer is the conversation's.
            visible={isVisible(members[0])}
            interactive={interactive}
            conversation={
              live && peer
                ? {
                    messages: sms.conversations[peer] ?? NO_MESSAGES,
                    onSend: (text: string) => void sms.send(peer, text),
                  }
                : undefined
            }
          />
        )
        // Spill is the sender template's call for the whole conversation. A table whose
        // balloons disagreed would be clipped down one column, which reads as a rendering
        // fault rather than as a choice — and that template is the one whose tail decides
        // how far the conversation may lean off the panel in the first place.
        return bubbles[members[0]].spill ? (
          <Fragment key={id}>{table}</Fragment>
        ) : (
          <div key={id} className="cb-bubble-clip" style={{ clipPath: clip }}>
            {table}
          </div>
        )
      })}
    </>
  )
}
