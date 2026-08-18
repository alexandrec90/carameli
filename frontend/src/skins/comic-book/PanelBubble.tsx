import { useEffect, useRef, useState } from 'react'

import { BUBBLE_VIEW, cloudPuffs } from './bubbleBox'
import { puffOpacity, resolveBubbleShape } from './bubbleShape'
import { BUBBLE_TYPES } from './editor/bubbleTypes'
import { bubbleStyle } from './editor/transforms'
import type { BubbleTransform } from './editor/types'
import { useBubbleMorph } from './useBubbleMorph'

/** How long a press holds its shape before easing back to the resting one. */
const PULSE_MS = 560

interface PanelBubbleProps {
  bubble: BubbleTransform
  /** Revealed — the panel it belongs to is hovered, or the editor is up. */
  visible: boolean
  /** False in edit mode: the editor overlay owns the pointer there. */
  interactive: boolean
}

/**
 * One speech bubble, drawn as vector geometry (see bubbleShape.ts) rather
 * than artwork so it can morph between shapes and weld to a connector tube.
 *
 * It stays decorative: `aria-hidden`, and it deliberately handles no `onClick`, so
 * a press still reaches the panel and navigates exactly as before — the shape pulse
 * rides along on `pointerdown`. That also keeps it clear of the jsx-a11y rules that
 * would demand keyboard handlers on a div; the panel itself is already keyboard
 * navigable for the real action.
 */
export default function PanelBubble({ bubble, visible, interactive }: PanelBubbleProps) {
  const [hover, setHover] = useState(false)
  const [pulsing, setPulsing] = useState(false)
  const timerRef = useRef(0)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const pulse = (): void => {
    window.clearTimeout(timerRef.current)
    setPulsing(true)
    timerRef.current = window.setTimeout(() => setPulsing(false), PULSE_MS)
  }

  const shape = resolveBubbleShape(bubble, { hover, pulsing })
  const pathRef = useBubbleMorph(shape, bubble.tail)
  // The puffs trail the tail, so a thought bubble with no tail simply has none.
  const puffs = cloudPuffs(bubble.tail)
  // Lettering follows the shape: a shout balloon in the speech font reads wrong,
  // and comics do swap the lettering when the balloon changes character.
  const font = BUBBLE_TYPES[shape].font

  const className = [
    'cb-panel-bubble',
    visible ? 'is-visible' : '',
    interactive ? 'is-interactive' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      aria-hidden="true"
      style={bubbleStyle(bubble)}
      onPointerEnter={interactive ? () => setHover(true) : undefined}
      onPointerLeave={interactive ? () => setHover(false) : undefined}
      onPointerDown={interactive ? pulse : undefined}
    >
      <svg
        className="cb-panel-bubble-svg"
        viewBox={`0 0 ${BUBBLE_VIEW.w} ${BUBBLE_VIEW.h}`}
        style={{ aspectRatio: `${BUBBLE_VIEW.w} / ${BUBBLE_VIEW.h}` }}
        aria-hidden="true"
      >
        {/* No `d` prop by design — useBubbleMorph owns the attribute. */}
        <path ref={pathRef} className="cb-bubble-shape" />
        <g className="cb-bubble-puffs" style={{ opacity: puffOpacity(shape) }}>
          {puffs.map(p => (
            <circle key={`${p.cx}-${p.cy}`} className="cb-bubble-shape" cx={p.cx} cy={p.cy} r={p.r} />
          ))}
        </g>
      </svg>
      <span className="cb-panel-bubble-text" style={{ fontFamily: `'${font}', cursive` }}>
        {bubble.text}
      </span>
    </div>
  )
}
