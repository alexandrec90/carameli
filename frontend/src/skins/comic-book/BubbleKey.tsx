import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'

import type { PhoneAction } from './phoneActions'

interface BubbleKeyProps {
  /** Which of the telephone's two keys this is — its artwork and its accessible name. */
  action: PhoneAction
  /** Greyed, and a press does nothing; the reason is the caller's (no number, no call, the editor). */
  disabled: boolean
  /** Where it sits in the balloon, on top of the key's own classes. */
  className?: string
  onPress(): void
}

/**
 * One drawn telephone key inside a balloon: the artwork *is* the button (the lettered
 * treatment in `bubbleInputs.css` would paste a square button around a picture of a round
 * one), and every event stops here rather than bubbling. The panel underneath reads a
 * press as "reveal this panel", and a key that also did that would flash the page on every
 * call placed or ended.
 *
 * Shared by the green key beside a dial's field (`BubbleCallKey`) and the red key beside
 * the number on the line (`BubbleNumberHangup`), so the two are one control in two colours
 * rather than two components that drift apart on the next event added to one of them.
 */
export default function BubbleKey({ action, disabled, className, onPress }: BubbleKeyProps) {
  const stopPointer = (event: PointerEvent<HTMLButtonElement>): void => event.stopPropagation()
  const stopKey = (event: KeyboardEvent<HTMLButtonElement>): void => event.stopPropagation()
  const press = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    onPress()
  }

  return (
    <button
      type="button"
      className={`cb-bubble-action cb-bubble-key${className ? ` ${className}` : ''}`}
      aria-label={action.label}
      disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={stopPointer}
      onKeyDown={stopKey}
      onClick={press}
    >
      <img className="cb-bubble-key-art" src={action.src} alt="" />
    </button>
  )
}
