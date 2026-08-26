import type { NumberPadProjection } from './types'
import { round, strLiteral } from './tsLiteral'

/** A number pad as the nested `numberPad: { … }` value of a picture entry. */
export function serializeNumberPad(pad: NumberPadProjection, indent = '  '): string {
  const inner = `${indent}  `
  const quad = pad.quad.map(([x, y]) => `[${round(x, 2)}, ${round(y, 2)}]`).join(', ')
  return [
    '{',
    `${inner}quad: [${quad}],`,
    `${inner}fontScale: ${round(pad.fontScale, 2)}, ink: ${strLiteral(pad.ink)},`,
    `${indent}}`,
  ].join('\n')
}

/** The picture-entry suffix for a number pad, or nothing when the image has none. */
export function numberPadSuffix(
  pad: NumberPadProjection | null | undefined,
  indent = '  ',
): string {
  return pad ? `, numberPad: ${serializeNumberPad(pad, indent)}` : ''
}
