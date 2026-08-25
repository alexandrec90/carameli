import { useEffect, useRef, useState } from 'react'

import {
  chainTranscript, clampHead, growTarget, stepHead, visibleWindow,
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
  /** The chain's settings, or the inert default for a name with no entry. */
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
 * One chain of speech bubbles, played as an SMS thread: messages arrive at the top of
 * the column and the wheel scrolls a window over the ones that no longer fit.
 *
 * The arithmetic is all in bubbleChain.ts; this is the DOM shell, the way BubbleWheel is
 * over wheelPicker. What it adds is the three pieces of state that cannot be pure — the
 * growth timer, the wheel listener, and the rewind when the panel stops being hovered.
 *
 * **Keys are message indices, not slot indices.** That is what makes the scroll animate:
 * a message keeps its DOM node as it moves down the column, so its `top`/`right`/`width`
 * change on an element that already exists and CSS transitions them, while a message
 * scrolled off the end unmounts and the new one at the top mounts into the arrival
 * animation. Keying by slot would swap the *contents* of four stationary balloons
 * instead, which reads as text flickering rather than as a thread moving.
 */
export default function PanelBubbleChain({
  chain, slots, visible, interactive,
}: PanelBubbleChainProps) {
  const messages = chainTranscript(chain, slots.map(s => s.text))
  const total = messages.length
  const full = growTarget(slots.length, total)

  // The newest message on screen. One number is the whole scroll position: which slot it
  // lands in falls out of it (see visibleWindow), so there is no second index to keep in
  // step and no way for the two to disagree.
  const [rawHead, setHead] = useState(() => (chain.grow ? 0 : full))
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
  useEffect(() => {
    if (visible) return
    const t = window.setTimeout(() => {
      steeredRef.current = false
      accRef.current = 0
      setHead(chain.grow ? 0 : full)
    }, REWIND_MS)
    return () => window.clearTimeout(t)
  }, [visible, chain.grow, full])

  // Growth: one balloon every stepMs until the drawn column is full, and no further.
  // Filling the column is where growth ends; going past it is scrolling, which is the
  // reader's. Re-armed per step rather than run on an interval so a change to stepMs —
  // an author dragging the field in the inspector — takes effect on the next balloon.
  useEffect(() => {
    if (!visible || !chain.grow || steeredRef.current || head >= full) return
    const t = window.setTimeout(() => setHead(h => Math.min(h + 1, full)), chain.stepMs)
    return () => window.clearTimeout(t)
  }, [visible, chain.grow, chain.stepMs, head, full])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !chain.scroll || total === 0) return
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
  }, [chain.scroll, total])

  const shown = visibleWindow(head, slots.length)

  return (
    <div ref={hostRef} className="cb-chain-layer">
      {shown.map((message, slot) => (
        <PanelBubble
          key={message}
          bubble={{ ...slots[slot], text: messages[message] }}
          visible={visible}
          interactive={interactive}
          chained
        />
      ))}
    </div>
  )
}
