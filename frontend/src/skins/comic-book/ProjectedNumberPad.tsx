import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'

import type { NumberPadProjection } from './editor/types'
import { surfaceStyle } from './tableProjection'
import './number-pad.css'

interface ProjectedNumberPadProps {
  numberPad: NumberPadProjection
  /** The picture's rendered rect in the clip wrapper's coordinates — the quad's base. */
  base: { x: number; y: number; w: number; h: number }
  /** Shows the alignment grid and keeps the projected layer out of editor gestures. */
  editing: boolean
  /**
   * Called with the key that was pressed, making the pad a working telephone keypad.
   * Omitted, the pad is a drawing: no pointer target, no buttons, no focus stops.
   */
  onKey?: (key: string) => void
}

/** Telephone-key order, row-major: three number rows followed by star, zero, hash. */
export const NUMBER_PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const

/** What each key is called out loud — "star" and "hash" read better than the glyphs. */
const KEY_LABELS: Record<string, string> = { '*': 'star', '#': 'hash' }

/** A fixed telephone number pad laid onto a photographed surface by one homography. */
export default function ProjectedNumberPad({
  numberPad,
  base,
  editing,
  onKey,
}: ProjectedNumberPadProps) {
  const { left, top, width, height, transform } = surfaceStyle(numberPad, base)
  if (transform === 'none') return null

  // Editing always wins: the corner grips sit on this same picture, and a pad that took
  // the pointer would swallow the very drags that place its own quad.
  const live = !editing && Boolean(onKey)

  const surface: CSSProperties = {
    left,
    top,
    width,
    height,
    transform,
    color: numberPad.ink,
    fontSize: `${(height / 4) * numberPad.fontScale}px`,
    pointerEvents: live ? 'auto' : 'none',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gridTemplateRows: 'repeat(4, 1fr)',
    outline: editing ? '1px dashed currentcolor' : undefined,
  }

  /** Presses on pointer-down, the way a physical key makes its tone on the way down. */
  const press = (key: string) => (event: PointerEvent<HTMLButtonElement>) => {
    // Stops the press from starting a text selection or an image drag on the photo.
    event.preventDefault()
    onKey?.(key)
  }

  /** Enter and Space, since the click those would raise is deliberately not listened for. */
  const pressByKeyboard = (key: string) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onKey?.(key)
  }

  return (
    <div
      className={`cb-number-pad-surface${editing ? ' cb-number-pad-editing' : ''}`}
      style={surface}
      role={live ? 'group' : 'img'}
      aria-label={live ? 'Number pad' : 'Projected number pad'}
    >
      {NUMBER_PAD_KEYS.map((key, index) => {
        const chrome: CSSProperties | undefined = editing
          ? {
              borderRight: (index + 1) % 3 === 0 ? undefined : '1px solid currentcolor',
              borderBottom: index >= 9 ? undefined : '1px solid currentcolor',
            }
          : undefined
        return live ? (
          <button
            key={key}
            type="button"
            className="cb-number-pad-key cb-number-pad-button"
            aria-label={KEY_LABELS[key] ?? key}
            onPointerDown={press(key)}
            onKeyDown={pressByKeyboard(key)}
          >
            {key}
          </button>
        ) : (
          <span key={key} className="cb-number-pad-key" aria-hidden="true" style={chrome}>
            {key}
          </span>
        )
      })}
    </div>
  )
}
