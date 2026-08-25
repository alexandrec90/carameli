import { useEffect, useRef, useState } from 'react'

import {
  chainTranscript, clampHead, growTarget, isComposerContent, messageSlots, stepHead,
  visibleWindow,
} from './bubbleChain'
import type { BubbleChain } from './bubbleChain'
import PanelBubble from './PanelBubble'
import type { BubbleTransform } from './editor/types'
import { wheelSteps } from './wheelPicker'

/**
 * How long after a chain is hidden its thread rewinds to the start. Past the balloons'
 * own fade (see `.cb-panel-bubble` in bubbles.css), so a chain that grew four messages
 * deep fades out four balloons deep instead of losing three of them mid-fade and
 * reading as a flicker.
 */
const REWIND_MS = 320

interface PanelBubbleChainProps {
  /** The chain's settings, or the inert default for an id with no entry. */
  chain: BubbleChain
  /**
   * The balloons the author drew, in slot order: slot 0 first, the lowest one, the root
   * that carries the tail. These never move — the messages move through them.
   */
  slots: BubbleTransform[]
  /** True while the panel is hovered; the thread runs from the start on each reveal. */
  visible: boolean
  /** False in edit mode: the editor overlay owns the pointer there. */
  interactive: boolean
}

/**
 * One chain of speech bubbles, played as an SMS thread: the newest message sits in the
 * root balloon, older ones climb the column above it, and the wheel scrolls a window over
 * the ones that no longer fit.
 *
 * A chain of three balloons shows *up to* three messages: fewer only while the thread is
 * shorter than the column. Past that the window moves rather than the column growing —
 * ten messages through three balloons is three on screen and the wheel to reach the rest.
 *
 * When the root balloon's content is a field (`input` or `phone`) the chain is **live**:
 * that slot becomes the composer, Enter pushes what was typed into the thread, and the
 * column grows by one balloon per message until the drawn slots are full. The composer
 * costs the root slot, so a three-balloon live chain is the field plus the two newest
 * messages — see `messageSlots`.
 *
 * The arithmetic is all in bubbleChain.ts; this is the DOM shell, the way BubbleWheel is
 * over wheelPicker. What it adds is the state that cannot be pure — the growth timer, the
 * wheel listener, the rewind when the panel stops being hovered, and the reader's own
 * messages.
 *
 * **Keys are message indices, not slot indices.** That is what makes the scroll animate:
 * a message keeps its DOM node as it moves up the column, so its `top`/`right`/`width`
 * change on an element that already exists and CSS transitions them, while a message
 * scrolled off the end unmounts and the new one at the root mounts into the arrival
 * animation. Keying by slot would swap the *contents* of four stationary balloons
 * instead, which reads as text flickering rather than as a thread moving.
 */
export default function PanelBubbleChain({
  chain, slots, visible, interactive,
}: PanelBubbleChainProps) {
  // What the reader has sent, oldest first. It lives here rather than in the config
  // because it is not the author's: it is gone on reload, like anything typed into a
  // page, and the editor never sees it.
  const [typed, setTyped] = useState<string[]>([])

  const root = slots.length > 0 ? slots[0] : null
  const live = root !== null && isComposerContent(root.content)
  // A live chain spends its root on the composer, so one fewer slot holds messages.
  const holders = messageSlots(slots.length, live)
  // A live chain does *not* fall back to the balloons' own words: the root's text is the
  // field's initial value, not a message, and the other slots are empty until a message
  // scrolls into them. Its ordinary starting state is a thread of nothing but a composer.
  const backlog = live ? chain.messages : chainTranscript(chain, slots.map(s => s.text))
  const messages = typed.length > 0 ? [...backlog, ...typed] : backlog
  const total = messages.length
  const full = growTarget(holders, total)
  // Where the thread sits when it has not been played or scrolled: at the newest message
  // for a live chain, the way a messaging app opens at the bottom of the conversation;
  // at the start of the transcript otherwise, so `grow` has somewhere to grow from.
  const start = live ? total - 1 : chain.grow ? 0 : full

  // The newest message on screen. One number is the whole scroll position: which slot it
  // lands in falls out of it (see visibleWindow), so there is no second index to keep in
  // step and no way for the two to disagree.
  const [rawHead, setHead] = useState(start)
  // The inspector can shorten the transcript out from under the scroll position, so the
  // stored head is clamped on the way *out* rather than corrected by an effect on the way
  // in: an effect would re-render a second time to say what this line already knows, and
  // would leave one frame drawn from the stale number in between.
  const head = clampHead(rawHead, total)
  // Set once the reader turns the wheel: growth is an opening flourish, and having it
  // resume under someone who has scrolled back through the thread would fight them.
  const steeredRef = useRef(false)
  const accRef = useRef(0)
  const hostRef = useRef<HTMLDivElement>(null)

  // Rewind once the panel is no longer hovered, so the thread plays again on the next
  // reveal rather than being found already finished. Deferred past the fade for the
  // reason REWIND_MS gives.
  //
  // A live chain is exempt. Its thread is the reader's, not an animation, and the panel
  // un-hovers the moment they move the pointer off it — rewinding there would throw away
  // what someone had just typed for having looked elsewhere.
  useEffect(() => {
    if (visible || live) return
    const t = window.setTimeout(() => {
      steeredRef.current = false
      accRef.current = 0
      setHead(chain.grow ? 0 : full)
    }, REWIND_MS)
    return () => window.clearTimeout(t)
  }, [visible, live, chain.grow, full])

  // Growth: one balloon every stepMs until the drawn column is full, and no further.
  // Filling the column is where growth ends; going past it is scrolling, which is the
  // reader's. Re-armed per step rather than run on an interval so a change to stepMs —
  // an author dragging the field in the inspector — takes effect on the next balloon.
  //
  // A live chain grows by being typed into instead, which is the same effect driven by
  // the reader, so the timer would only race them to it.
  useEffect(() => {
    if (!visible || live || !chain.grow || steeredRef.current || head >= full) return
    const t = window.setTimeout(() => setHead(h => Math.min(h + 1, full)), chain.stepMs)
    return () => window.clearTimeout(t)
  }, [visible, live, chain.grow, chain.stepMs, head, full])

  // Always listening: a chain *is* a window over a transcript, so the wheel moving it is
  // what a chain means rather than a setting on one. With nothing to scroll to there is
  // nothing to take the wheel away from the page for.
  useEffect(() => {
    const host = hostRef.current
    if (!host || total === 0) return
    const onWheel = (e: WheelEvent) => {
      // A `content: 'wheel'` balloon inside the chain has its own picker and calls
      // preventDefault on the same event as it bubbles up. Yield to it: the inner
      // control is the one under the pointer, and turning both at once would move the
      // option list out from under the reader's selection.
      if (e.defaultPrevented) return
      // Native and non-passive for the reason BubbleWheel gives: React registers wheel
      // listeners passive, and a passive handler cannot keep the page scrolling away
      // from under the thread.
      e.preventDefault()
      const { acc, steps } = wheelSteps(accRef.current, e.deltaY)
      accRef.current = acc
      if (steps === 0) return
      steeredRef.current = true
      setHead(h => stepHead(h, steps, total))
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [total])

  /**
   * Send what the composer holds. The head jumps to the new message rather than staying
   * where it was: sending is the strongest possible statement that this is the message
   * you want to be looking at, and `total` is its index because it is measured before the
   * append.
   */
  const send = (text: string): void => {
    setTyped(prev => [...prev, text])
    setHead(total)
  }

  const shown = visibleWindow(head, holders)
  // The composer occupies slot 0 on a live chain, so message k hangs one slot higher.
  const offset = live ? 1 : 0

  return (
    <div ref={hostRef} className="cb-chain-layer">
      {root && live ? (
        <PanelBubble
          key="composer"
          bubble={root}
          visible={visible}
          interactive={interactive}
          chained
          onSubmit={send}
        />
      ) : null}
      {shown.map((message, slot) => (
        <PanelBubble
          key={message}
          bubble={{ ...slots[slot + offset], text: messages[message] }}
          visible={visible}
          interactive={interactive}
          chained
        />
      ))}
    </div>
  )
}
