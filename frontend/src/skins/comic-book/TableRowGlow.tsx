import type { TableProjection } from './editor/types'
import { rowBand } from './tableData'
import './lit-surface.css'

interface TableRowGlowProps {
  /** The surface, for the one thing this needs from it: whether a band goes to a heading. */
  table: Pick<TableProjection, 'header'>
  /** Visible body row under the pointer, or `null` when the pointer is off the rows. */
  row: number | null
  /** Whether that row is being pressed right now. */
  pressed: boolean
}

/**
 * The lit band behind the row under the pointer.
 *
 * **The same light the projected number pad throws** — literally the same rules, in
 * `lit-surface.css`, because a row and a key are both "a thing on this photograph that
 * the pointer is on" and answering them differently would read as two unrelated surfaces.
 * That file says why the glow is one uniform colour rather than a fill inside a ring, and
 * why the press flares past the brightest moment of the hover pulse.
 *
 * It is a band of its own rather than a background on the `<tr>` because a glow is a
 * `box-shadow`, and the row's cells are clipped (`overflow: hidden`, for the ellipsis) —
 * a halo painted in one of them would stop at the column's edge. Placed by band
 * arithmetic ({@link rowBand}), so it lands on the same ruled line the row's lettering
 * does at every scroll offset.
 *
 * **It carries no `z-index`, and must not.** It rides inside its own picture's wrapper,
 * so a picture at a greater depth — a hand over the notepad — is a later sibling and
 * paints over the light exactly as it paints over the rows (`imageDepth.ts`). One
 * z-index here would lift the highlight out of that order and put it over the hand.
 */
export default function TableRowGlow({ table, row, pressed }: TableRowGlowProps) {
  if (row === null) return null
  return (
    <div
      className={`cb-ptable-glow${pressed ? ' is-pressed' : ''}`}
      style={{ top: `calc(var(--cb-ptable-row) * ${rowBand(table, row)})` }}
      aria-hidden="true"
    />
  )
}
