import { useEffect, useRef } from 'react'

import { BUBBLE_VIEW } from './bubbleBox'
import { BUBBLE_TYPES } from './editor/bubbleTypes'
import { HANGUP_KEY } from './phoneActions'
import { useBubbleMorph } from './useBubbleMorph'
import type { CallTranscriptLine } from '../../lib/callTranscript'

interface CallBubbleProps {
  /** This seat's side of the conversation, oldest first. */
  lines: readonly CallTranscriptLine[]
  /** This seat's voice is on the line: the outline bolds, as a hovered balloon's does. */
  speaking: boolean
  /** Accessible name of the transcript — whose words these are. */
  label: string
  /** On the caller's balloon only: the red key, always lit, that ends the call. */
  onEnd?: () => void
}

/**
 * One party's speech bubble in the call scene: a plain `soft` balloon with its tail
 * down at the speaker, holding that party's lines of the transcript — a scrolling
 * window, since a call says more than an ellipse holds — and, on the caller's side, the
 * telephone's red key under the words.
 *
 * Always revealed, unlike a panel balloon: the two bubbles are the conversation, not a
 * caption on the picture. And one balloon per party rather than a chain, because a
 * transcript is one voice continuing, which is what a single balloon means.
 */
export default function CallBubble({ lines, speaking, label, onEnd }: CallBubbleProps) {
  const pathRef = useBubbleMorph('soft', 'down')
  const logRef = useRef<HTMLDivElement>(null)
  const font = BUBBLE_TYPES.soft.font

  // The newest line stays in view: a transcript only grows, so the window follows its
  // end whenever a line lands. The reader's wheel scrolls back between lines.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  const className = [
    'cb-panel-bubble',
    'cb-call-bubble',
    'is-visible',
    'is-interactive',
    speaking ? 'is-bold' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className}>
      <svg
        className="cb-panel-bubble-svg"
        viewBox={`0 0 ${BUBBLE_VIEW.w} ${BUBBLE_VIEW.h}`}
        style={{ aspectRatio: `${BUBBLE_VIEW.w} / ${BUBBLE_VIEW.h}` }}
        aria-hidden="true"
      >
        {/* No `d` prop by design — useBubbleMorph owns the attribute. */}
        <path ref={pathRef} className="cb-bubble-shape" pointerEvents="none" />
      </svg>
      <div className="cb-panel-bubble-text cb-call-bubble-body" style={{ fontFamily: `'${font}', cursive` }}>
        <div ref={logRef} className="cb-call-transcript" role="log" aria-label={label} aria-live="polite">
          {lines.map(line => (
            <p key={line.id} className="cb-call-line">{line.text}</p>
          ))}
        </div>
        {onEnd && (
          <button
            type="button"
            className="cb-bubble-action cb-bubble-key cb-call-end"
            aria-label={HANGUP_KEY.label}
            onClick={onEnd}
          >
            <img className="cb-bubble-key-art" src={HANGUP_KEY.src} alt="" draggable={false} />
          </button>
        )}
      </div>
    </div>
  )
}
