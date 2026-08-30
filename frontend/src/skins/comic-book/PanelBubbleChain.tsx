import { useEffect, useRef, useState } from 'react'

import {
  chainColumns, chainRowLinks, chainTranscript, clampHead, conversationRows, growTarget,
  isComposerContent, messageRows, OUT_PREFIX, readTranscript, recipientStemTarget,
  smsTranscript, stepHead, TYPING_KEY, visibleWindow,
} from './bubbleChain'
import type { BubbleChain } from './bubbleChain'
import { tubeBetween } from './bubbleTube'
import PanelBubble from './PanelBubble'
import { bubbleRect } from './editor/transforms'
import type { BubbleTransform } from './editor/types'
import type { SmsConversationMessage } from '../../lib/smsConversation'
import { useDialWheel } from './useDialWheel'

/**
 * How long after a chain is hidden its conversation rewinds to the start. Past the
 * balloons' own fade (see `.cb-panel-bubble` in bubbles.css), so a chain that grew four
 * messages deep fades out four balloons deep instead of losing three of them mid-fade and
 * reading as a flicker.
 */
const REWIND_MS = 320

interface PanelBubbleChainProps {
  /** The chain's settings, or the inert default for an id with no entry. */
  chain: BubbleChain
  /**
   * The balloons the author drew, rightmost first: member 0 is the sender's column and the
   * last is the recipient's. They are *templates* — every row of the conversation is
   * stamped from the one whose side it belongs to.
   */
  members: BubbleTransform[]
  /** True while the panel is hovered; the conversation runs from the start on each reveal. */
  visible: boolean
  /** False in edit mode: the editor overlay owns the pointer there. */
  interactive: boolean
  /** The composer owns panel-wide keyboard and wheel input. */
  keyboard?: boolean
  /**
   * Reports the pointer arriving on and leaving the composer, so the panel's keyboard
   * router can hand it the keyboard the way it does any other field (panelKeyboard.ts).
   * A conversation claims through its composer alone: the rows above it are messages,
   * and the pointer on one of those is reading rather than aiming to type.
   */
  onComposerHover?: (hovered: boolean) => void
  /**
   * The real SMS conversation this chain is bound to, when it is bound to one — supplied
   * by PanelBubbles from the number the panel's wheel picker is turned to.
   *
   * Present, it replaces *both* halves of the offline behaviour: the transcript is the
   * carrier's rather than the author's, and Enter in the composer sends rather than
   * appending locally. Nothing typed is kept here — a sent message reaches the panel again
   * by coming back from the server, which is what makes the balloon on screen evidence
   * that something was actually delivered rather than evidence that it was typed.
   */
  conversation?: LiveConversation
}

/** One live conversation, as far as the chain is concerned. */
export interface LiveConversation {
  /** The carrier transcript, oldest first. */
  messages: readonly SmsConversationMessage[]
  /** Send as the account, to whoever this conversation is with. */
  onSend: (text: string) => void
  /**
   * True while the peer is composing, for the typing-dots row. Only the dev simulation
   * ever sets it — a carrier has no typing signal to relay — so a live chain simply
   * never shows the row.
   */
  typing?: boolean
}

/**
 * One chain of speech bubbles, played as an SMS conversation: two columns — the recipient
 * on the left, the sender on the right — sharing one transcript that runs up the panel from
 * the composer, newest first, with the wheel scrolling a window over the rest.
 *
 * A six-row chain shows *up to* six messages: fewer only while the conversation is shorter
 * than the table. Past that the window moves rather than the table growing — twenty
 * messages through six rows is six on screen and the wheel to reach the rest.
 *
 * When the sender template's content is a field (`input` or `phone`) the chain is **live**:
 * the bottom-right row becomes the composer, Enter pushes what was typed into the
 * conversation as the sender's own message, and the table grows by one row per message
 * until it is full. The composer costs a row, so a live six-row chain is the field plus the
 * five newest messages — see `messageRows`.
 *
 * The arithmetic is all in bubbleChain.ts; this is the DOM shell, the way BubbleWheel is
 * over wheelPicker. What it adds is the state that cannot be pure — the growth timer, the
 * wheel listener, the panel's measured aspect ratio, the rewind when the panel stops being
 * hovered, and the reader's own messages.
 *
 * **Keys are message indices, not row indices.** That is what makes the scroll animate: a
 * message keeps its DOM node as it climbs the table, so its `top`/`right`/`width` change on
 * an element that already exists and CSS transitions them, while a message scrolled off the
 * end unmounts and the new one at the bottom mounts into the arrival animation. Keying by
 * row would swap the *contents* of six stationary balloons instead, which reads as text
 * flickering rather than as a conversation moving.
 */
export default function PanelBubbleChain({
  chain, members, visible, interactive, keyboard = false, onComposerHover, conversation,
}: PanelBubbleChainProps) {
  // What the reader has sent, oldest first, already marked as the sender's side. It lives
  // here rather than in the config because it is not the author's: it is gone on reload,
  // like anything typed into a page, and the editor never sees it.
  const [typed, setTyped] = useState<string[]>([])
  // The panel's width/height ratio, which is what converts a balloon's width into the share
  // of the panel's *height* it occupies. 1 until measured: an unmeasured chain still stacks
  // in the right order, merely spaced as though the panel were square.
  const [aspect, setAspect] = useState(1)
  const [size, setSize] = useState({ width: 0, height: 0 })

  const cols = chainColumns(members)
  const live = cols !== null && isComposerContent(cols.me.content)
  // A chain that asked to be bound and was not — the panel has no number yet, or has one
  // half-typed. It must not answer its own composer. `typed` below is a single array on
  // this component, so it does not belong to any peer and outlives every change of one:
  // an orphaned chain that kept messages would show the same transcript under every
  // unresolvable number, which reads as one conversation following the reader around.
  // Nothing is dropped that was ever going anywhere — an unbound chain has no destination
  // for the message in the first place, and saying so by doing nothing is better than
  // drawing a balloon that was never sent.
  const orphaned = chain.sms && !conversation
  // A live chain spends its bottom row on the composer, so one fewer row holds messages.
  const holders = messageRows(chain.rows, live)
  // The typing row spends a message row while it is up, the way the composer spends one
  // for good: the table's height budget is the panel's, so the dots displace the oldest
  // visible message rather than stacking past the top.
  const typing = conversation?.typing === true
  // How many messages the window holds, which is what the render and the wheel's floor
  // are both measured in — they have to be the same number or the wheel stops one row
  // short of, or one row past, the table it is moving.
  const windowRows = holders - (typing ? 1 : 0)
  // A live chain does *not* fall back to the balloons' own words: the sender template's
  // text is the field's initial value, not a message. Its ordinary starting state is a
  // conversation of nothing but a composer.
  const backlog = live ? chain.messages : chainTranscript(chain, members)
  // A bound chain shows the carrier's transcript and nothing else — not the authored
  // backlog, and not `typed`. Its own messages come back through `conversation.messages`,
  // so appending them here as well would draw each one twice.
  const messages = conversation
    ? smsTranscript(conversation.messages)
    : typed.length > 0
      ? [...backlog, ...typed]
      : backlog
  const total = messages.length
  const full = growTarget(holders, total)
  // The oldest the wheel goes: the head at which the window is *first* full. A window is a
  // fixed pane over a transcript — twenty messages through six rows is six on screen at
  // every scroll position, not six at the bottom thinning to one at the top — and without
  // this the reader can walk the head down to 0 and be left looking at a single balloon
  // with five empty rows above it. On a transcript shorter than the table this is its last
  // message, so a two-message chain still scrolls to the first of the two.
  const floor = growTarget(windowRows, total)
  // Where the conversation sits when it has not been played or scrolled: at the newest
  // message for a live chain, the way a messaging app opens at the bottom; at the start of
  // the transcript otherwise, so `grow` has somewhere to grow from.
  const start = live ? total - 1 : chain.grow ? 0 : full

  // The newest message on screen. One number is the whole scroll position: which row it
  // lands in falls out of it (see visibleWindow), so there is no second index to keep in
  // step and no way for the two to disagree.
  const [rawHead, setHead] = useState(start)
  // The inspector can shorten the transcript out from under the scroll position, so the
  // stored head is clamped on the way *out* rather than corrected by an effect on the way
  // in: an effect would re-render a second time to say what this line already knows, and
  // would leave one frame drawn from the stale number in between.
  const head = clampHead(rawHead, total)
  // Set once the reader turns the wheel: growth is an opening flourish, and having it
  // resume under someone who has scrolled back through the conversation would fight them.
  const steeredRef = useRef(false)
  const hostRef = useRef<HTMLDivElement>(null)

  // The layer is inset to the panel box exactly (see bubbleChains.css), so measuring it
  // measures the panel — and the rows have to be laid out against the same box the author's
  // percentages were dragged out against. Observed rather than measured once, because the
  // three viewport layouts reshape every panel.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = (): void => {
      const { width, height } = host.getBoundingClientRect()
      if (width > 0 && height > 0) {
        setAspect(width / height)
        setSize({ width, height })
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
  }, [])

  // Rewind once the panel is no longer hovered, so the conversation plays again on the next
  // reveal rather than being found already finished. Deferred past the fade for the reason
  // REWIND_MS gives.
  //
  // A live chain is exempt. Its conversation is the reader's, not an animation, and the
  // panel un-hovers the moment they move the pointer off it — rewinding there would throw
  // away what someone had just typed for having looked elsewhere.
  useEffect(() => {
    if (visible || live) return
    const t = window.setTimeout(() => {
      steeredRef.current = false
      setHead(chain.grow ? 0 : full)
    }, REWIND_MS)
    return () => window.clearTimeout(t)
  }, [visible, live, chain.grow, full])

  // Growth: one message every stepMs until the table is full, and no further. Filling the
  // table is where growth ends; going past it is scrolling, which is the reader's.
  // Re-armed per step rather than run on an interval so a change to stepMs — an author
  // dragging the field in the inspector — takes effect on the next message.
  //
  // A live chain grows by being typed into instead, which is the same effect driven by the
  // reader, so the timer would only race them to it.
  useEffect(() => {
    if (!visible || live || !chain.grow || steeredRef.current || head >= full) return
    const t = window.setTimeout(() => setHead(h => Math.min(h + 1, full)), chain.stepMs)
    return () => window.clearTimeout(t)
  }, [visible, live, chain.grow, chain.stepMs, head, full])

  // A bound conversation grows on its own: a message arrives on a poll rather than on a
  // timer or a keystroke, and nothing in this component asked for it. Follow the newest one
  // so an incoming reply appears where a phone would put it — unless the reader has
  // scrolled back through the conversation, which is the same courtesy `grow` gets, and for
  // the same reason: yanking the window to the bottom under someone reading the start of
  // the thread is the one thing an arriving message must not do.
  const bound = conversation != null
  useEffect(() => {
    if (!bound || steeredRef.current || total === 0) return
    setHead(total - 1)
  }, [bound, total])

  const turnRef = useRef<(steps: number) => void>(() => undefined)
  useEffect(() => {
    turnRef.current = steps => {
      steeredRef.current = true
      setHead(h => stepHead(h, steps, total, floor))
    }
  }, [total, floor])
  useDialWheel(hostRef, keyboard, visible && total > 0, turnRef)

  /**
   * Send what the composer holds. It joins the conversation as the *sender's* message —
   * the composer is the sender's balloon, so there is no other side it could be on — and
   * the head jumps to it rather than staying where it was: sending is the strongest
   * possible statement that this is the message you want to be looking at. `total` is its
   * index because it is measured before the append.
   */
  const send = (text: string): void => {
    // Bound: hand it to the carrier and keep nothing. The message is drawn as soon as the
    // hook shows it pending, and `bound`'s effect above puts the window on it, so there is
    // no head to set here that the arriving message would not set anyway.
    if (conversation) {
      conversation.onSend(text)
      steeredRef.current = false
      return
    }
    // Asked for a carrier and got none: see `orphaned`. The local buffer is for a chain
    // the author wrote as an offline animation, never for one waiting on a number.
    if (orphaned) return
    setTyped(prev => [...prev, `${OUT_PREFIX}${text}`])
    setHead(total)
  }

  if (!cols) return null

  /** How far a message has got, for the balloon's ink. Undefined once it is simply sent. */
  const statusAt = (key: string): 'sending' | 'failed' | 'typing' | undefined => {
    if (key === TYPING_KEY) return 'typing'
    if (!conversation || key === 'composer') return undefined
    const status = conversation.messages[Number(key)]?.status
    return status === 'sent' || status === undefined ? undefined : status
  }

  const rows = conversationRows(
    visibleWindow(head, windowRows),
    readTranscript(messages),
    cols,
    live,
    aspect,
    typing,
  )
  const tubes = chainRowLinks(rows).flatMap(([below, row]) => {
    if (size.width === 0) return []
    const bounds = { x: 0, y: 0, w: size.width, h: size.height }
    const geo = tubeBetween(
      bubbleRect(bounds, below.bubble),
      bubbleRect(bounds, row.bubble),
    )
    return geo ? [{ key: `${below.key}-${row.key}`, geo }] : []
  })
  const newestRecipient = rows.find(row => row.side === 'in' && row.bubble.tail !== 'none')

  return (
    <div ref={hostRef} className="cb-chain-layer">
      {tubes.length > 0 && (
        <svg className="cb-chain-tubes" aria-hidden="true">
          {tubes.map(tube => (
            <g key={tube.key} className={`cb-tube${visible ? ' is-visible' : ''}`}>
              <path className="cb-tube-fill cb-chain-tube-path" d={tube.geo.fill} />
              {tube.geo.rails.map((d, index) => (
                <path key={index} className="cb-tube-rail cb-chain-tube-path" d={d} />
              ))}
            </g>
          ))}
        </svg>
      )}
      {rows.map(row => (
        <PanelBubble
          key={row.key}
          bubble={row.bubble}
          visible={visible}
          interactive={interactive}
          chained
          keyboard={row.key === 'composer' && keyboard}
          onHoverChange={row.key === 'composer' ? onComposerHover : undefined}
          tailTarget={
            row === newestRecipient && cols
              ? recipientStemTarget(cols.them, row.bubble, aspect)
              : undefined
          }
          onSubmit={row.key === 'composer' ? send : undefined}
          status={statusAt(row.key)}
        />
      ))}
    </div>
  )
}
