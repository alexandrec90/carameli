import { useEffect, useMemo, useRef, useState } from 'react'

import { BUBBLE_VIEW, cloudPuffs } from './bubbleBox'
import {
  bubbleShapeCandidates,
  hitPuffs,
  hitRingPoints,
  pathD,
  puffOpacity,
  resolveBubbleShape,
} from './bubbleShape'
import BubbleActions from './BubbleActions'
import BubbleDial from './BubbleDial'
import BubbleInput from './BubbleInput'
import BubbleTypingDots from './BubbleTypingDots'
import BubbleWheel from './BubbleWheel'
import { isDialContent } from './bubbleContent'
import { dialOptions } from './dialPicker'
import { BUBBLE_TYPES } from './editor/bubbleTypes'
import { bubbleStyle } from './editor/transforms'
import type { BubbleTransform } from './editor/types'
import type { PhoneActionHandlers } from './phoneActions'
import { useBubbleMorph } from './useBubbleMorph'
import { splitOptions } from './wheelPicker'

/** How long a press holds its shape before easing back to the resting one. */
const PULSE_MS = 560

/** A dial with nowhere to report to still draws; it just cannot be changed. */
const noop = (): void => undefined

/** One shared empty list, so a dial's shortlist is not rebuilt on every render. */
const NOTHING_DIALLED: string[] = []

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
   * This field owns panel-wide keyboard input while visible, so it focuses itself the
   * moment the panel reveals it. Decided by the panel (`panelKeyboard.ts`) and never
   * here: which balloon a keystroke belongs to depends on what else is drawn beside it,
   * which is not a question this component can answer about itself. Absent — a balloon
   * rendered outside a panel, as the editor's own previews are — means no field grabs
   * anything, which is the safe answer rather than a second rule.
   */
  keyboard?: boolean
  /** Fixed SVG-space endpoint for a chain row's speech stem. */
  tailTarget?: [number, number]
  /** Reports pointer ownership to the panel's keyboard router. */
  onHoverChange?: (hovered: boolean) => void
  /**
   * Passed through to an `input`/`phone` balloon: Enter sends the field's contents here
   * and clears it. A chain's composer supplies one, and so does a standalone `phone`
   * balloon, whose Enter places the call. A `dial` balloon's Enter places the call too,
   * without clearing. Every other input balloon keeps what is typed in it.
   */
  onSubmit?: (value: string) => void
  /**
   * Passed through to a `wheel` balloon: the picked option, reported on mount and on every
   * turn. Only the balloon a panel reads a phone number off supplies one.
   */
  onWheelSelect?: (value: string) => void
  /**
   * A `dial` balloon's number and the way to change it. The pair is the panel's, not this
   * balloon's — the projected keypad writes to the same value (see ComicPanel) — so both
   * arrive together or not at all, and a dial rendered without them is an inert display.
   */
  dialValue?: string
  /** Whether that number is drum-supplied and so replaced, not appended to, by the next key. */
  dialFresh?: boolean
  onDialChange?: (value: string, fresh: boolean) => void
  /**
   * Numbers already dialled from this panel. They join the author's own options, so the
   * drum is the shortlist plus whatever the reader has reached that was not on it.
   */
  dialled?: string[]
  /**
   * Passed through to an `actions` balloon: what each of the telephone's keys does. Absent
   * in the editor and on any page with no telephone, where the keys are drawn but inert.
   */
  actions?: PhoneActionHandlers
  /**
   * How far a message of a live conversation has got. Absent on every balloon that is not
   * one, and on one whose message the carrier has acknowledged — a sent message is just a
   * message. Drawn as ink rather than as words: a sending balloon is pale and a failed one
   * is struck in red (see bubbleChains.css), because a status *line* would be a seventh row
   * in a six-row table. `typing` is the peer's balloon before there are words: no text,
   * animated dots.
   */
  status?: 'sending' | 'failed' | 'typing'
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
  keyboard,
  tailTarget,
  onHoverChange,
  onSubmit,
  onWheelSelect,
  dialValue = '',
  dialFresh = false,
  onDialChange,
  dialled = NOTHING_DIALLED,
  actions,
  status,
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
  const pathRef = useBubbleMorph(shape, bubble.tail, tailTarget)
  // The puffs trail the tail, so a thought bubble with no tail simply has none.
  const puffs = cloudPuffs(bubble.tail)
  const puffsOpacity = puffOpacity(shape)
  // The hit region is every shape this bubble can take, overlaid, so it is the same
  // region whatever `shape` currently is. Deriving it from the drawn outline instead
  // let a hover shrink the outline out from under the cursor, which un-hovered it,
  // which restored the outline — a standing cursor flickered between the two forever.
  const hitShapes = bubbleShapeCandidates(bubble)
  const hitPuffList = hitPuffs(bubble, bubble.tail)
  const hitPointerEvents = visible && interactive ? 'all' : 'none'
  // Lettering follows the shape: a shout balloon in the speech font reads wrong,
  // and comics do swap the lettering when the balloon changes character.
  const font = BUBBLE_TYPES[shape].font
  const editableKind =
    bubble.content === 'input' || bubble.content === 'phone' ? bubble.content : null
  // Either dial kind — they differ only by the call key, which changes nothing about how
  // the balloon is placed, revealed, or given the keyboard (see isDialContent).
  const dial = isDialContent(bubble.content)
  // Every kind that puts a real form control in the balloon, which is the question the
  // wrapper's aria and focus handling actually asks — a dial has one too, and so do the
  // action buttons.
  const hasField = editableKind !== null || dial || bubble.content === 'actions'
  // The dial's drum: what the author listed, then what has been dialled that they did not.
  // Memoized so the filter BubbleDial runs over it survives a hover — this balloon
  // re-renders on every pointer enter and leave. Its re-seat keys on the contents rather
  // than on this identity, so a missed memo would be slow, never wrong.
  const dialList = useMemo(
    () => dialOptions(splitOptions(bubble.text), dialled),
    [bubble.text, dialled],
  )
  // A keyboard user can tab to an otherwise hidden control; focus reveals its bubble
  // immediately and blur returns it to the panel-hover reveal rule.
  const shown = visible || focused
  const holdsKeyboard = keyboard === true

  const className = [
    'cb-panel-bubble',
    shown ? 'is-visible' : '',
    interactive ? 'is-interactive' : '',
    chained ? 'cb-chain-bubble' : '',
    status ? `is-${status}` : '',
    // The heavier outline, and only ever this balloon's: `hover` is local state on this
    // component, so a linked partner, the tube between them and the rows above this one
    // in a chain are all somebody else's render and keep the resting weight. The tail
    // and the thought puffs do bold, because they are the same ring and the same class.
    hover && bubble.hoverBold ? 'is-bold' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={rootRef}
      className={className}
      aria-hidden={hasField ? undefined : true}
      style={bubbleStyle(bubble)}
      // On the wrapper, though the wrapper itself takes no pointer: enter and leave
      // are synthesized from the subtree, so this is "the pointer is somewhere in the
      // bubble" — the hit outline or the input — rather than "on this one element".
      // Hung off the outline instead, stepping from it into the input read as a leave.
      onPointerEnter={interactive ? () => {
        setHover(true)
        onHoverChange?.(true)
      } : undefined}
      onPointerLeave={interactive ? () => {
        setHover(false)
        onHoverChange?.(false)
      } : undefined}
      onPointerDown={interactive ? pulse : undefined}
      onFocusCapture={hasField && interactive ? () => setFocused(true) : undefined}
      onBlurCapture={hasField && interactive ? () => setFocused(false) : undefined}
    >
      <svg
        className="cb-panel-bubble-svg"
        viewBox={`0 0 ${BUBBLE_VIEW.w} ${BUBBLE_VIEW.h}`}
        style={{ aspectRatio: `${BUBBLE_VIEW.w} / ${BUBBLE_VIEW.h}` }}
        aria-hidden="true"
      >
        {/* No `d` prop by design — useBubbleMorph owns the attribute. */}
        <path ref={pathRef} className="cb-bubble-shape" pointerEvents="none" />
        <g className="cb-bubble-puffs" style={{ opacity: puffsOpacity }} pointerEvents="none">
          {puffs.map(p => (
            <circle key={`${p.cx}-${p.cy}`} className="cb-bubble-shape" cx={p.cx} cy={p.cy} r={p.r} />
          ))}
        </g>
        {/* The hit region: unpainted, never morphs, and — with a real input, the only
            other thing here that takes a pointer — all a hover or a press can land on.
            `all` rather than `visiblePainted` because it has no paint to be visible;
            see hitRingPoints for what it covers and why it is a shape per state. The
            panel hover reads this same group (usePanelHover), so a spilled balloon
            keeps its panel lit over exactly the region that answers to the pointer. */}
        <g className="cb-bubble-hit" pointerEvents={hitPointerEvents}>
          {hitShapes.map(t => (
            <path key={t} d={pathD(hitRingPoints(t, bubble.tail))} />
          ))}
          {hitPuffList.map(p => (
            <circle key={`${p.cx}-${p.cy}`} cx={p.cx} cy={p.cy} r={p.r} />
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
          revealed={visible && holdsKeyboard}
          onSubmit={onSubmit}
        />
      ) : dial ? (
        <BubbleDial
          options={dialList}
          value={dialValue}
          fresh={dialFresh}
          onChange={onDialChange ?? noop}
          font={font}
          // Open on focus as well as on hover, unlike a plain wheel: typing into a dial
          // filters its drum, and a filter whose result only appears when the pointer
          // happens to be over the balloon is a filter nobody can see working.
          open={hover || focused}
          // Exactly what an `input` balloon gets, and from the same place: a hover is
          // already ownership by the time it reaches here (see panelKeyboard.ts), so
          // adding it a second time would let a hovered dial hold the keyboard the
          // panel had just handed to the composer beside it.
          revealed={visible && holdsKeyboard}
          enabled={interactive}
          hostRef={rootRef}
          onSubmit={onSubmit}
          // The one difference between the two dial kinds: the telephone's green key,
          // drawn at the right of the field and greyed until there is a number to dial.
          call={bubble.content === 'dial-call'}
        />
      ) : bubble.content === 'actions' ? (
        <BubbleActions text={bubble.text} font={font} enabled={interactive} actions={actions} />
      ) : bubble.content === 'wheel' ? (
        <BubbleWheel
          options={splitOptions(bubble.text)}
          font={font}
          open={hover}
          hostRef={rootRef}
          onSelect={onWheelSelect}
        />
      ) : (
        <span className="cb-panel-bubble-text" style={{ fontFamily: `'${font}', cursive` }}>
          {status === 'typing' ? <BubbleTypingDots /> : bubble.text}
        </span>
      )}
    </div>
  )
}
