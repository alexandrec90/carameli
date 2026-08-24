import { DEFAULT_QUAD } from '../tableProjection'
import type { Quad } from '../tableProjection'
import { FONT_SCALE } from '../tableData'
import { coerceQuad } from './tableValidate'
import type { NumberPadProjection } from './types'

/** A fresh projected number pad, visible and draggable as soon as it is selected. */
export function newNumberPad(): NumberPadProjection {
  return {
    quad: DEFAULT_QUAD.map(([x, y]) => [x, y]) as Quad,
    fontScale: 0.55,
    ink: '#1b3a8f',
  }
}

function boundedNumber(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(number, FONT_SCALE.min), FONT_SCALE.max)
}

/** Repair a persisted number pad, or return undefined when it has no usable quad. */
export function coerceNumberPad(value: unknown): NumberPadProjection | undefined {
  if (value == null || typeof value !== 'object') return undefined
  const pad = value as Partial<NumberPadProjection>
  const quad = coerceQuad(pad.quad)
  if (!quad) return undefined
  return {
    quad,
    fontScale: boundedNumber(pad.fontScale, 0.55),
    ink: typeof pad.ink === 'string' ? pad.ink : '#1b3a8f',
  }
}

/** Deep copy a number pad so editor corner drags cannot mutate the source config. */
export function cloneNumberPad(pad: NumberPadProjection): NumberPadProjection {
  return { ...pad, quad: pad.quad.map(([x, y]) => [x, y]) as Quad }
}
