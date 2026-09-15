import type { TableProjection } from './editor/types'
import { bandSpan, rowBand } from './tableData'

interface TableRowBandProps {
  /** The surface, for what this needs from it: whether a band goes to a heading, and where the bands fall. */
  table: Pick<TableProjection, 'header' | 'rows' | 'lines'>
  /** Visible body row under the pointer, or `null` when the pointer is off the rows. */
  row: number | null
  /** The surface's laid-out height in px — what the band fractions are fractions of. */
  height: number
}

/**
 * The band washed behind the row under the pointer.
 *
 * **One flat, semi-transparent wash of the authored ink, and nothing else** — no pulse,
 * no halo, and nothing at all on the press. It is deliberately not what the projected
 * number pad does to a key: that pad's glyphs are painted `transparent` outside the
 * editor, so its glow is the only thing saying a key is there, while a row is already
 * written on the page and only needs picking out. `table.css` carries the rest of that
 * reasoning.
 *
 * It is a band of its own rather than a background on the `<tr>` because the cells are
 * clipped for their ellipsis and are the wrong box to paint a full-width row from.
 * Placed by band arithmetic ({@link rowBand} into {@link bandSpan}) — the same list the
 * row's own cells take their height from — so it lands on the same ruled line the row's
 * lettering does at every scroll offset, and on a fitted surface follows the drawn line
 * exactly as the row does.
 *
 * **It carries no `z-index`, and must not.** It rides inside its own picture's wrapper,
 * so a picture at a greater depth — a hand over the notepad — is a later sibling and
 * paints over the wash exactly as it paints over the rows (`imageDepth.ts`). One z-index
 * here would lift the highlight out of that order and put it over the hand.
 */
export default function TableRowBand({ table, row, height }: TableRowBandProps) {
  if (row === null) return null
  const span = bandSpan(table, rowBand(table, row))
  return (
    <div
      className="cb-ptable-band"
      style={{ top: `${span.top * height}px`, height: `${span.height * height}px` }}
      aria-hidden="true"
    />
  )
}
