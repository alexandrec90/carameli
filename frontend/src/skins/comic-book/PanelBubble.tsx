import { useEffect, useRef, useState } from 'react'

import { BUBBLE_VIEW, cloudPuffs } from './bubbleBox'
import { puffOpacity, resolveBubbleShape } from './bubbleShape'
import BubbleInput from './BubbleInput'
import BubbleWheel from './BubbleWheel'
import { BUBBLE_TYPES } from './editor/bubbleTypes'
import { bubbleStyle } from './editor/transforms'
import type { BubbleTransform } from './editor/types'
import { useBubbleMorph } from './useBubbleMorph'
import { splitOptions } from './wheelPicker'

/** How long a press holds its shape before easing back to the resting one. */
const PULSE_MS = 560

interface PanelBubbleProps {
  bubble: BubbleTransform
  /** Revealed — the panel it belongs to is hovered, or the editor is up. */
  visible: boolean
  /** False in edit mode: the editor overlay owns the pointer there. */
  interactive: boolean
  /**
   * True when this balloon is a slot of a live chain (see PanelBubbleChain). It moves
   * between slots as the thread scrolls, so its placement animates rather than jumping,
   * and it eases in on arrival instead of being there from the start. Off by default,
   * and off in the editor, where a drag has to track the pointer exactly.
   */
  chained?: boolean
  /**
   * Passed through to an `input`/`phone` balloon: Enter sends the field's contents here
   * and clears it. Only a chain's composer supplies one; every other input balloon keeps
   * what is typed in it.
   */
  onSubmit?: (value: string) => void
}

/**
 * One speech bubble, drawn as vector geometry (see bubbleShape.ts) rather
 * than artwork so it can morph between shapes and weld to a connector tube.
 *
 * Text and wheel content stay decorative: `aria-hidden`, and a press still reaches
 * the panel and navigates. Input content is a real form control instead; it stops its
 * pointer and keyboard events so editing it never triggers the panel underneath.
 */
export default function PanelBubble({
  bubble,
  visible,
  interactive,
  chained = false,
  onSubmit,
}: PanelBubbleProps) {
  const [hover, setHover] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pulsing, setPulsing] = useState(false)
  const timerRef = useRef(0)
  // Handed to BubbleWheel so its wheel listener covers the whole balloon.
  const rootRef = useRef<HTMLDivElement>(null)

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
  const editableKind =
    bubble.content === 'input' || bubble.content === 'phone' ? bubble.content : null
  // A keyboard user can tab to an otherwise hidden input; focus reveals its bubble
  // immediately and blur returns it to the panel-hover reveal rule.
  const shown = visible || focused

  const className = [
    'cb-panel-bubble',
    shown ? 'is-visible' : '',
    interactive ? 'is-interactive' : '',
    chained ? 'cb-chain-bubble' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={rootRef}
      className={className}
      aria-hidden={editableKind ? undefined : true}
      style={bubbleStyle(bubble)}
      onPointerEnter={interactive ? () => setHover(true) : undefined}
      onPointerLeave={interactive ? () => setHover(false) : undefined}
      onPointerDown={interactive ? pulse : undefined}
      onFocusCapture={editableKind && interactive ? () => setFocused(true) : undefined}
      onBlurCapture={editableKind && interactive ? () => setFocused(false) : undefined}
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
      {editableKind ? (
        <BubbleInput
          key={`${editableKind}:${bubble.text}`}
          kind={editableKind}
          initialValue={bubble.text}
          font={font}
          enabled={interactive}
          onSubmit={onSubmit}
        />
      ) : bubble.content === 'wheel' ? (
        <BubbleWheel options={splitOptions(bubble.text)} font={font} open={hover} hostRef={rootRef} />
      ) : (
        <span className="cb-panel-bubble-text" style={{ fontFamily: `'${font}', cursive` }}>
          {bubble.text}
        </span>
      )}
    </div>
  )
}
