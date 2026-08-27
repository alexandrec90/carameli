import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'

import { phoneAction } from './phoneActions'
import type { PhoneActionHandler, PhoneActionHandlers } from './phoneActions'
import { splitOptions } from './wheelPicker'

interface BubbleActionsProps {
  /** The authored text: one button per comma-delimited entry. */
  text: string
  font: string
  enabled: boolean
  /**
   * What each key does on this page. A key with no handler here is still drawn and still
   * pressable — it just does nothing, which is what the editor and any page without a
   * telephone show.
   */
  actions?: PhoneActionHandlers
}

/**
 * The buttons of an `actions` balloon.
 *
 * A label naming one of the telephone's keys (see `phoneActions.ts`) is drawn as its
 * artwork, because the balloon sits on a photograph of a telephone and lettering the word
 * "Call" beside one is a caption, not a key. Anything else is lettered as before.
 *
 * Every press is stopped here rather than allowed to bubble: the panel underneath treats
 * a press as "reveal this panel", and a button that also did that would flash the page
 * every time the phone was answered.
 */
export default function BubbleActions({ text, font, enabled, actions }: BubbleActionsProps) {
  const stopPointer = (event: PointerEvent<HTMLButtonElement>): void => event.stopPropagation()
  const stopKey = (event: KeyboardEvent<HTMLButtonElement>): void => event.stopPropagation()
  const press = (handler?: PhoneActionHandler) => (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    handler?.run()
  }

  return (
    <div
      className="cb-panel-bubble-text cb-bubble-actions"
      style={{ fontFamily: `'${font}', cursive` }}
    >
      {splitOptions(text).map(label => {
        const key = phoneAction(label)
        const handler = key ? actions?.[key.id] : undefined
        const off = !enabled || (handler?.disabled ?? false)
        return (
          <button
            key={label}
            type="button"
            className={key ? 'cb-bubble-action cb-bubble-key' : 'cb-bubble-action'}
            aria-label={key ? key.label : undefined}
            disabled={off}
            tabIndex={off ? -1 : 0}
            onPointerDown={stopPointer}
            onClick={press(handler)}
            onKeyDown={stopKey}
          >
            {key ? <img className="cb-bubble-key-art" src={key.src} alt="" /> : label}
          </button>
        )
      })}
    </div>
  )
}
