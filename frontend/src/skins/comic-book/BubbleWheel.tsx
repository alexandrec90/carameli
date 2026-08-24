import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import { clampIndex, wheelOffsetEm, wheelSteps } from './wheelPicker'

interface BubbleWheelProps {
  /** The option list, already split from the bubble's comma-delimited text. */
  options: string[]
  /** Lettering font for the current shape, same as the plain-text span uses. */
  font: string
  /** True while the pointer is over the bubble: the unpicked options fade in. */
  open: boolean
  /**
   * The bubble's root element. The wheel listener goes on the whole balloon, not on
   * this component's own box, so scrolling anywhere over the bubble turns the picker
   * rather than only over the text region.
   */
  hostRef: RefObject<HTMLDivElement | null>
}

/**
 * The wheel-picker presentation of a bubble's text: a drum of options behind a
 * window clipped inside the balloon, turned by the mouse wheel. Only the picked
 * option is inked at rest; hovering the bubble fades the neighbours in above and
 * below it, iOS-picker style.
 *
 * All the arithmetic — option splitting, delta accumulation, end-stop clamping, the
 * track offset — lives in wheelPicker.ts; this component is the DOM shell. Like the
 * rest of the bubble it stays decorative (the parent is `aria-hidden` and this adds
 * no focusable element), and it takes no pointer handler of its own beyond the wheel,
 * so a press still reaches the panel and navigates.
 */
export default function BubbleWheel({ options, font, open, hostRef }: BubbleWheelProps) {
  const [index, setIndex] = useState(0)
  // Sub-step wheel travel carried between events (see wheelSteps). A ref, not state:
  // its value changes on every trackpad tick and must not re-render anything.
  const accRef = useRef(0)
  const count = options.length

  // The inspector can edit options out from under the selection; keep it in range.
  useEffect(() => {
    setIndex(i => clampIndex(i, Math.max(count, 1)))
  }, [count])

  useEffect(() => {
    const host = hostRef.current
    if (!host || count === 0) return
    const onWheel = (e: WheelEvent) => {
      // Native and non-passive on purpose: React registers its wheel listeners
      // passive, and a passive handler cannot keep the page from scrolling away
      // under the turning picker.
      e.preventDefault()
      const { acc, steps } = wheelSteps(accRef.current, e.deltaY)
      accRef.current = acc
      if (steps !== 0) setIndex(i => clampIndex(i + steps, count))
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [hostRef, count])

  return (
    <div
      className={`cb-panel-bubble-text cb-bubble-wheel${open ? ' is-open' : ''}`}
      style={{ fontFamily: `'${font}', cursive` }}
    >
      <div
        className="cb-wheel-track"
        style={{ transform: `translateY(${wheelOffsetEm(index)}em)` }}
      >
        {options.map((opt, i) => (
          <div key={i} className={`cb-wheel-option${i === index ? ' is-selected' : ''}`}>
            {opt}
          </div>
        ))}
      </div>
    </div>
  )
}
