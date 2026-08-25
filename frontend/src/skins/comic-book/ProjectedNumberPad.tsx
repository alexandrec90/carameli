import type { CSSProperties } from 'react'

import type { NumberPadProjection } from './editor/types'
import { surfaceStyle } from './tableProjection'
import './number-pad.css'

interface ProjectedNumberPadProps {
  numberPad: NumberPadProjection
  frame: { w: number; h: number }
  /** Shows the alignment grid and keeps the projected layer out of editor gestures. */
  editing: boolean
}

/** Telephone-key order, row-major: three number rows followed by star, zero, hash. */
export const NUMBER_PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const

/** A fixed telephone number pad laid onto a photographed surface by one homography. */
export default function ProjectedNumberPad({
  numberPad,
  frame,
  editing,
}: ProjectedNumberPadProps) {
  const { width, height, transform } = surfaceStyle(numberPad, frame)
  if (transform === 'none') return null

  const surface: CSSProperties = {
    width,
    height,
    transform,
    color: numberPad.ink,
    fontSize: `${(height / 4) * numberPad.fontScale}px`,
    pointerEvents: 'none',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gridTemplateRows: 'repeat(4, 1fr)',
    outline: editing ? '1px dashed currentcolor' : undefined,
  }

  return (
    <div
      className={`cb-number-pad-surface${editing ? ' cb-number-pad-editing' : ''}`}
      style={surface}
      role="img"
      aria-label="Projected number pad"
    >
      {NUMBER_PAD_KEYS.map((key, index) => (
        <span
          key={key}
          className="cb-number-pad-key"
          aria-hidden="true"
          style={
            editing
              ? {
                  borderRight: (index + 1) % 3 === 0 ? undefined : '1px solid currentcolor',
                  borderBottom: index >= 9 ? undefined : '1px solid currentcolor',
                }
              : undefined
          }
        >
          {key}
        </span>
      ))}
    </div>
  )
}
