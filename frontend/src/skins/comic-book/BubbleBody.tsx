import type { RefObject } from 'react'

import BubbleActions from './BubbleActions'
import BubbleDial from './BubbleDial'
import BubbleInput from './BubbleInput'
import BubbleTypingDots from './BubbleTypingDots'
import BubbleWheel from './BubbleWheel'
import type { BubbleTransform } from './editor/types'
import type { PhoneActionHandlers } from './phoneActions'
import { splitOptions } from './wheelPicker'
import type { CallTranscriptLine } from '../../lib/callTranscript'

/** A dial with nowhere to report to still draws; it just cannot be changed. */
const noop = (): void => undefined

interface BubbleBodyProps {
  bubble: BubbleTransform
  /** Which free-text field this balloon holds, or null when it holds none. */
  editableKind: 'input' | 'phone' | null
  /** Either dial kind — see `isDialContent`. */
  dial: boolean
  /** A window on the call rather than on the balloon's own `text`. */
  transcript: boolean
  /** The lettering the current shape asks for. */
  font: string
  /** False in edit mode: the editor overlay owns the pointer there. */
  enabled: boolean
  /** Revealed *and* holding the panel's keyboard: together, a field that focuses itself. */
  revealed: boolean
  /** The pointer is somewhere in the balloon. */
  hover: boolean
  /** Something inside it has focus — a keyboard user's equivalent of that hover. */
  focused: boolean
  /** The balloon's own element: what a drum hangs off and a wheel listens on. */
  hostRef: RefObject<HTMLDivElement | null>
  /** The transcript's scrolling window, so the newest line can be kept in view. */
  logRef: RefObject<HTMLDivElement | null>
  /** The dial's drum: the author's options plus what has been dialled since. */
  dialList: string[]
  dialValue: string
  dialFresh: boolean
  onDialChange?: (value: string, fresh: boolean) => void
  onSubmit?: (value: string) => void
  onWheelSelect?: (value: string) => void
  actions?: PhoneActionHandlers
  status?: 'sending' | 'failed' | 'typing'
  lines: readonly CallTranscriptLine[]
  /** Accessible name for the transcript log — whose words these are. */
  linesLabel?: string
}

/**
 * What is drawn *inside* a balloon, which is one choice between six kinds and nothing
 * else. Split out of PanelBubble.tsx so that file keeps only the questions every balloon
 * asks — its shape, its hit region, its hover — and this one keeps the branch.
 *
 * Deliberately not a lookup table. Each arm passes a different set of props, several of
 * them derived here from `hover`/`focused`, so a table would be the same branch written as
 * data plus a second place to look for what an arm actually gets.
 */
export default function BubbleBody({
  bubble,
  editableKind,
  dial,
  transcript,
  font,
  enabled,
  revealed,
  hover,
  focused,
  hostRef,
  logRef,
  dialList,
  dialValue,
  dialFresh,
  onDialChange,
  onSubmit,
  onWheelSelect,
  actions,
  status,
  lines,
  linesLabel,
}: BubbleBodyProps) {
  if (editableKind) {
    return (
      <BubbleInput
        key={`${editableKind}:${bubble.text}`}
        kind={editableKind}
        initialValue={bubble.text}
        font={font}
        enabled={enabled}
        revealed={revealed}
        onSubmit={onSubmit}
      />
    )
  }

  if (dial) {
    return (
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
        // already ownership by the time it reaches here (see panelKeyboard.ts), so adding
        // it a second time would let a hovered dial hold the keyboard the panel had just
        // handed to the composer beside it.
        revealed={revealed}
        enabled={enabled}
        hostRef={hostRef}
        onSubmit={onSubmit}
        // The one difference between the two dial kinds: the telephone's green key, drawn
        // at the right of the field and greyed until there is a number to dial.
        call={bubble.content === 'dial-call'}
      />
    )
  }

  if (bubble.content === 'actions') {
    return <BubbleActions text={bubble.text} font={font} enabled={enabled} actions={actions} />
  }

  if (transcript) {
    return (
      <div
        ref={logRef}
        className="cb-panel-bubble-text cb-call-transcript"
        style={{ fontFamily: `'${font}', cursive` }}
        role="log"
        aria-label={linesLabel}
        aria-live="polite"
      >
        {lines.map(line => (
          <p key={line.id} className="cb-call-line">{line.text}</p>
        ))}
      </div>
    )
  }

  if (bubble.content === 'wheel') {
    return (
      <BubbleWheel
        options={splitOptions(bubble.text)}
        font={font}
        open={hover}
        hostRef={hostRef}
        onSelect={onWheelSelect}
      />
    )
  }

  return (
    <span className="cb-panel-bubble-text" style={{ fontFamily: `'${font}', cursive` }}>
      {status === 'typing' ? <BubbleTypingDots /> : bubble.text}
    </span>
  )
}
