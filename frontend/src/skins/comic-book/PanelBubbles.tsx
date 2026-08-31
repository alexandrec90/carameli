import { useCallback, useEffect, useState } from 'react'

import { chainIdsOn, chainMembers, defaultChain, peerPickerOn } from './bubbleChain'
import type { BubbleChain } from './bubbleChain'
import { isDialContent } from './bubbleContent'
import type { SceneHalves } from './callSceneGeometry'
import { inRoles } from './callSceneRoles'
import { bubbleClaim, bubbleKey, chainClaim, chainKey, keyboardOwner } from './panelKeyboard'
import type { KeyboardClaim } from './panelKeyboard'
import PanelChainThread from './PanelChainThread'
import PanelFlatBubble from './PanelFlatBubble'
import type { BubbleTransform, CallRole } from './editor/types'
import type { Rect } from './panelGeometry'
import type { PhoneActionHandlers } from './phoneActions'
import { browserCountry, toE164 } from './phoneInput'
import type { UseSmsConversationsResult } from '../../hooks/useSmsConversations'
import type { CallTranscript } from '../../lib/callTranscript'

/**
 * A panel with nothing dialled yet: the dial's shortlist is memoized on this array's
 * identity, so a fresh `[]` per render would rebuild it every time.
 */
const EMPTY_DIALLED: string[] = []

/** One shared "nothing lit", for the same reason. */
const NONE_LIT: readonly CallRole[] = []

interface PanelBubblesProps {
  /** Every bubble on the page — `panel` decides which ones this panel draws. */
  bubbles: BubbleTransform[]
  /** Chain settings, one per chain name the bubbles carry. */
  chains: BubbleChain[]
  /** Index of the panel being drawn, into PANELS. */
  panel: number
  /**
   * Which call roles are on screen, or `null` for the panel's ordinary layout — the whole
   * of the layout switch, exactly as in PanelImages. It settles the panel's keyboard too:
   * a field in the layout that is *not* showing states no claim, so drawing a call over a
   * panel hands the keyboard to whatever the call itself draws.
   */
  callRoles?: CallRole[] | null
  /**
   * The panel cut in two, while a call is up on it. A balloon whose role names a side is
   * placed in a slot at that side, so its `top`/`right`/`width` are percentages of the
   * half it belongs to and the author frames it against what they can see.
   */
  halves?: SceneHalves | null
  /** Roles inked heavy right now — the speaker's (`litRoles` in callSceneRoles.ts). */
  lit?: readonly CallRole[]
  /**
   * The words of the call on this panel, for its `transcript` balloons. Each one shows its
   * own role's seat; one with no role shows both seats in the order they were said.
   */
  transcript?: CallTranscript
  /** Box of the panel being drawn, in viewport coords — where a half's slot sits inside it. */
  bounds: Rect
  /** CSS clip-path of the panel polygon, for bubbles that don't spill. */
  clip: string
  /** Whether bubble `index` (into `bubbles`) is currently revealed. */
  isVisible: (index: number) => boolean
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
   * Either `dial` balloon dials on Enter too, and for the same reason: it is a phone field
   * with a shortlist behind it. A `dial-call` sends its own call key here as well, so the
   * key and Enter place the same call.
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
   * Reports the number a bound chain has just been texted from this panel, so it joins
   * that same shortlist. A conversation started on a number the reader typed is otherwise
   * reachable exactly once: the picker only offers what the author listed and what has
   * been dialled, so turning the drum away from a typed peer is a one-way door, and every
   * number typed after it opens another empty thread with no way back to the last.
   *
   * Sending is the event rather than the number resolving, because a valid number is not
   * yet a conversation — a reader part-way through typing passes through other people's
   * numbers, and a drum that collected those would be a list of near misses.
   */
  onPeerTexted?(value: string): void
  /**
   * What the telephone's keys do, for any `actions` balloon on this panel. Absent in the
   * editor and on a page with no telephone: the keys are drawn there and do nothing.
   */
  phoneActions?: PhoneActionHandlers
}

/**
 * The bubbles belonging to one panel, in whichever of its layouts is showing. A panel may
 * own several or none — the array is filtered by `panel` and `callRoles` rather than
 * indexed by either, so adding a bubble in the editor is an append and never has to line
 * up with anything.
 *
 * Each bubble is placed against this panel's box by `bubbleStyle`, so it must render
 * inside the panel element even when `spill` lets its ink cross the panel edge; that
 * is why this is a fragment of siblings and not its own positioned layer. A balloon in
 * one half of a call scene gets a slot element at that half, and nothing else changes:
 * its percentages then resolve against the half, which is the box the author framed it in.
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
  callRoles = null,
  halves = null,
  lit = NONE_LIT,
  transcript,
  bounds,
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
  onPeerTexted,
  phoneActions,
}: PanelBubblesProps) {
  const ids = editing ? [] : chainIdsOn(bubbles, panel)
  const threads = ids.map(id => ({
    id,
    members: chainMembers(bubbles, id, panel),
    chain: chains.find(c => c.id === id) ?? defaultChain(id),
  }))
  // Indices the conversations have claimed, so the flat pass below skips them. Every
  // thread on the panel, drawn or not: a member of a conversation the other layout owns
  // is still not a loose balloon, and drawing it as one is how a hidden layout leaks.
  const claimed = new Set(threads.flatMap(c => c.members))
  // A conversation belongs to the layout its sender template does; the rest of its
  // balloons follow, because a table split across two layouts is not a table.
  const conversations = threads.filter(c => inRoles(bubbles[c.members[0]]?.call, callRoles))

  // The balloon whose options are phone numbers, or -1 on a panel with no picker.
  const pickerIndex = peerPickerOn(bubbles, panel)
  // A dial picker reports nothing: its number is the panel's, because the keypad in the
  // picture writes to it too. So the number a chain binds to comes from the prop rather
  // than from the local selection below, and the two are never both in play.
  const dialPicker = pickerIndex >= 0 && isDialContent(bubbles[pickerIndex].content)
  // Whichever option the drum is showing. Reported by BubbleWheel on mount as well as on
  // every turn, so this is populated before the reader touches anything.
  const [picked, setPicked] = useState('')
  // Stable, because BubbleWheel reports through an effect and would re-report on every
  // render of this panel otherwise — which is a render of this panel, forever.
  const onWheelSelect = useCallback((value: string) => setPicked(value), [])

  // Which balloon the reader is typing into. Every field on the panel states a claim and
  // `keyboardOwner` settles it — the pointer first, then the strongest claim if it stands
  // alone, and nobody at all when two of equal standing would have to be guessed between.
  // The answer belongs to the panel rather than to a balloon: drawing a second field
  // changes what the first one is entitled to, which no balloon can see from inside.
  const claims: KeyboardClaim[] = [
    ...bubbles.flatMap((b, i) =>
      b.panel === panel && !claimed.has(i) && inRoles(b.call, callRoles)
        ? [{ key: bubbleKey(i), claim: bubbleClaim(b.content) }]
        : [],
    ),
    ...conversations.map(c => ({
      key: chainKey(c.id),
      claim: chainClaim(bubbles[c.members[0]]?.content ?? ''),
    })),
  ]
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const owner = keyboardOwner(claims, hoveredKey)
  // Cleared only by the balloon that set it: a pointer crossing straight from one balloon
  // to another reports the arrival before the departure, and a blind clear would drop the
  // new owner on the leave that follows it.
  const hoverReporter = (key: string) => (hovered: boolean) =>
    setHoveredKey(current => {
      if (hovered) return key
      return current === key ? null : current
    })

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
      {bubbles.map((bubble, i) =>
        bubble.panel !== panel || claimed.has(i) || !inRoles(bubble.call, callRoles) ? null : (
          <PanelFlatBubble
            key={i}
            bubble={bubble}
            index={i}
            halves={halves}
            bounds={bounds}
            clip={clip}
            visible={isVisible(i)}
            interactive={interactive}
            owner={owner}
            hoverReporter={hoverReporter}
            pickerIndex={pickerIndex}
            onWheelSelect={onWheelSelect}
            transcript={transcript}
            lit={lit}
            onPhoneSubmit={onPhoneSubmit}
            dialValue={dialValue}
            dialFresh={dialFresh}
            dialled={dialled}
            onDialChange={onDialChange}
            phoneActions={phoneActions}
          />
        ),
      )}
      {conversations.map(({ id, members, chain }) => (
        <PanelChainThread
          key={id}
          chain={chain}
          members={members.map(i => bubbles[i])}
          halves={halves}
          bounds={bounds}
          clip={clip}
          // Every member of a chain belongs to this panel, so they reveal and hide
          // together; the sender template's answer is the conversation's.
          visible={isVisible(members[0])}
          interactive={interactive}
          keyboard={owner === chainKey(id)}
          onComposerHover={hoverReporter(chainKey(id))}
          peer={peer}
          chosen={chosen}
          sms={sms}
          onPeerTexted={onPeerTexted}
        />
      ))}
    </>
  )
}
