import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'

import { splitOptions } from './wheelPicker'

interface BubbleActionsProps {
  /** The authored text: one button per comma-delimited entry. */
  text: string
  font: string
  enabled: boolean
}

/**
 * A column of placeholder buttons fitted inside a speech bubble — one per
 * comma-delimited entry of the authored text. They press but do nothing yet: the
 * balloon reserves the reader's controls (call, hang up, …) ahead of the wiring.
 */
export default function BubbleActions({ text, font, enabled }: BubbleActionsProps) {
  const stopPointer = (event: PointerEvent<HTMLButtonElement>): void => event.stopPropagation()
  const stopClick = (event: MouseEvent<HTMLButtonElement>): void => event.stopPropagation()
  const stopKey = (event: KeyboardEvent<HTMLButtonElement>): void => event.stopPropagation()

  return (
    <div
      className="cb-panel-bubble-text cb-bubble-actions"
      style={{ fontFamily: `'${font}', cursive` }}
    >
      {splitOptions(text).map(label => (
        <button
          key={label}
          type="button"
          className="cb-bubble-action"
          disabled={!enabled}
          tabIndex={enabled ? 0 : -1}
          onPointerDown={stopPointer}
          onClick={stopClick}
          onKeyDown={stopKey}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
