import type { TableColumn, TableProjection } from './types'
import { round, strLiteral } from './tsLiteral'

// A projected table, back out as TypeScript. Its own module rather than three more
// helpers in serialize.ts, which is at the size limit; the seam is that nothing here
// knows about pictures, bubbles or grids.

/** One column literal. */
function columnLiteral(c: TableColumn): string {
  return `{ label: ${strLiteral(c.label)}, width: ${round(c.width, 2)}, align: '${c.align}' }`
}

/** One data row as an array literal. */
function rowLiteral(row: string[]): string {
  return `[${row.map(strLiteral).join(', ')}]`
}

/**
 * A table as the `table: { … }` value of a picture entry, indented to sit under it.
 *
 * Multi-line, unlike every other value in `layoutConfig.ts`, because a surface carries
 * the author's cells: a hundred of them on one line is a diff nobody can read, and the
 * point of saving back to source is that a framing change arrives as a reviewable diff.
 *
 * `quad` stays on one line and rounds to 2 places — about a hundredth of the frame,
 * finer than a corner can be dragged — so nudging one corner changes one line.
 */
export function serializeTable(t: TableProjection, indent = '  '): string {
  const i2 = `${indent}  `
  const i3 = `${indent}    `
  const quad = t.quad.map(([x, y]) => `[${round(x, 2)}, ${round(y, 2)}]`).join(', ')
  const columns = t.columns.map(c => `${i3}${columnLiteral(c)},`).join('\n')
  const data = t.data.map(r => `${i3}${rowLiteral(r)},`).join('\n')
  return [
    `{`,
    `${i2}quad: [${quad}],`,
    `${i2}rows: ${Math.round(t.rows)}, header: ${t.header}, ` +
      `fontScale: ${round(t.fontScale, 2)}, ink: ${strLiteral(t.ink)},`,
    // Absent, not `source: undefined`, on an authored surface — the same spelling the
    // type and the hydrator use, so a config that went out without a feed comes back
    // without one. A live surface's `data` is empty by construction, so the block below
    // emits `data: []` and no call record is ever written into the repository.
    ...(t.source ? [`${i2}source: '${t.source}',`] : []),
    `${i2}columns: [`,
    columns,
    `${i2}],`,
    `${i2}data: [`,
    data,
    `${i2}],`,
    `${indent}}`,
  ]
    // A surface with no columns or no rows yet emits an empty block rather than a blank
    // line inside the array literal, which is not valid TS to paste back.
    .filter(line => line !== '')
    .join('\n')
}

/** The `, table: { … }` suffix for a picture entry, or `''` when it is not a surface. */
export function tableSuffix(t: TableProjection | null | undefined, indent = '  '): string {
  return t ? `, table: ${serializeTable(t, indent)}` : ''
}
