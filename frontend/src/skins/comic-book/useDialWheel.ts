import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { wheelSteps } from './wheelPicker'

/**
 * The dial's wheel gesture: scrolling turns the drum.
 *
 * The listener's reach follows the keyboard's. Normally it covers the balloon
 * (`hostRef`), exactly as BubbleWheel's does; while the balloon is revealed by its
 * panel — when the reveal has already handed the dial the keyboard — it covers the
 * whole panel, so the drum turns wherever the pointer rests rather than only over one
 * balloon. The panel element is looked up (`.cb-panel`, ComicPanel's root) rather than
 * threaded down through three components that would not otherwise mention it; a host
 * outside any panel (a test harness) keeps the balloon reach.
 *
 * Native and non-passive on purpose: React registers its wheel listeners passive, and
 * a passive handler cannot keep the page from scrolling away under the picker. An
 * event another balloon has already taken — a chain's scrollback, a wheel picker —
 * arrives here `defaultPrevented`, because those listeners sit on descendants of the
 * panel and have run first; it is left to them.
 *
 * `turnRef` rather than a callback so the listener registers once per reach, never per
 * render (see the ref's comment in BubbleDial).
 */
export function useDialWheel(
  hostRef: RefObject<HTMLDivElement | null>,
  revealed: boolean,
  active: boolean,
  turnRef: RefObject<(steps: number) => void>,
): void {
  // Sub-step wheel travel carried between events (see wheelSteps).
  const accRef = useRef(0)
  useEffect(() => {
    const host = hostRef.current
    if (!host || !active) return
    const target = revealed ? (host.closest<HTMLElement>('.cb-panel') ?? host) : host
    const onWheel = (e: WheelEvent): void => {
      if (e.defaultPrevented) return
      e.preventDefault()
      const { acc, steps } = wheelSteps(accRef.current, e.deltaY)
      accRef.current = acc
      if (steps !== 0) turnRef.current(steps)
    }
    target.addEventListener('wheel', onWheel, { passive: false })
    return () => target.removeEventListener('wheel', onWheel)
  }, [hostRef, revealed, active, turnRef])
}
