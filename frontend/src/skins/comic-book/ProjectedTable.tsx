import { useRef, useState } from 'react'
import type { CSSProperties, WheelEvent as ReactWheelEvent } from 'react'

import type { TableProjection } from './editor/types'
import {
  BAND_SIT,
  bandSpan,
  bodyRows,
  clampScroll,
  columnPercents,
  filledRows,
  maxScroll,
  rowBand,
  visibleRows,
  wheelDeltaPx,
  wheelRows,
} from './tableData'
import TableRowBand from './TableRowBand'
import { surfaceStyle } from './tableProjection'
import './table.css'

interface ProjectedTableProps {
  /** The surface: its corners, its bands, its columns and its cells. */
  table: TableProjection
  /** The picture's rendered rect in the clip wrapper's coordinates — the quad's base. */
  base: { x: number; y: number; w: number; h: number }
  /**
   * Editor mode. Draws the band guides and the surface outline, and takes the table out
   * of the pointer's way: the overlay's own click targets sit over this panel, and a
   * table that swallowed the wheel would zoom nothing while looking like it should.
   */
  editing: boolean
}

/** What a row reports to the surface above it, so the band can follow the pointer. */
interface RowPointer {
  onEnter(): void
  onLeave(): void
}

/** A row's worth of cells, or the heading row. */
function Row({
  cells,
  aligns,
  bandPx,
  head,
  pointer,
}: {
  cells: string[]
  aligns: TableProjection['columns'][number]['align'][]
  /**
   * This row's own band height, in px. Set on the row rather than once on the surface
   * because the bands need not be equal: a fitted surface (`table.lines`) gives each row
   * the height of the drawn band it sits in, and the cells read the value through
   * inheritance — the same custom property, one level closer.
   */
  bandPx: number
  head?: boolean
  /**
   * Present on a row a reader can point at — a body row with data behind it. Absent on
   * the heading and on the blank bands {@link visibleRows} pads the window with, which
   * are ruled lines with nothing written on them and so light up for nothing.
   */
  pointer?: RowPointer
}) {
  const Cell = head ? 'th' : 'td'
  const band: CSSProperties = {
    ['--cb-ptable-row' as string]: `${bandPx}px`,
    ['--cb-ptable-sit' as string]: `${bandPx * BAND_SIT}px`,
  }
  return (
    <tr
      className={pointer ? 'cb-ptable-row' : undefined}
      style={band}
      onPointerEnter={pointer?.onEnter}
      onPointerLeave={pointer?.onLeave}
    >
      {cells.map((text, i) => (
        <Cell key={i} className="cb-ptable-cell" style={{ textAlign: aligns[i] ?? 'left' }}>
          {text}
        </Cell>
      ))}
    </tr>
  )
}

/**
 * An HTML table laid flat onto the surface a picture depicts.
 *
 * The table is laid out as an ordinary rectangle and then mapped onto the picture's quad
 * by a single `matrix3d` (see `tableProjection.ts`), so the lettering is real selectable
 * text sitting in perspective rather than an image of a table. Nothing here knows that
 * the picture is a notepad: any picture can carry a surface, which is the point.
 *
 * **Scrolling moves whole rows and nothing else.** The offset is an index into the data,
 * so band *k* renders at exactly the same place on the surface at every offset and the
 * rows stay welded to the lines drawn in the picture. There is no scrollbar and no
 * scroll container — the window of rows is sliced out of the data, so there is nothing
 * for a browser to draw a bar against.
 */
export default function ProjectedTable({ table, base, editing }: ProjectedTableProps) {
  const [rawOffset, setRawOffset] = useState(0)
  // The visible body row the pointer is on. State rather than `:hover` in the stylesheet
  // because the wash is not painted on the row: it is a band of its own behind the table
  // (see TableRowBand), and CSS has no way to reach across from one to the other.
  const [hovered, setHovered] = useState<number | null>(null)
  // Carried wheel travel. A ref, not state: a trackpad emits a dozen sub-row deltas
  // where a mouse emits one whole notch, and re-rendering for each of them would be a
  // render per pixel of a scroll that has not moved a row yet.
  const carry = useRef(0)

  const { left, top, width, height, transform } = surfaceStyle(table, base)
  if (transform === 'none') return null

  // Derived rather than corrected in an effect: the row count and the data both change
  // under the editor's hands, and an offset repaired on the next tick renders one frame
  // of rows that are not there.
  const offset = clampScroll(table, rawOffset)
  const scrollable = maxScroll(table) > 0
  const rowH = height / Math.max(1, table.rows)
  const aligns = table.columns.map(c => c.align)
  const percents = columnPercents(table.columns)
  // Derived for the same reason the offset is: the data shrinks under the editor's hands
  // and under a poll of a live feed, so the row that was lit a moment ago may now be a
  // blank band — and the editor takes the pointer off the surface entirely.
  const filled = editing ? 0 : filledRows(table, offset)
  const lit = hovered !== null && hovered < filled ? hovered : null

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    // `pointer-events: none` already keeps the wheel off the surface in the editor, but
    // the rule is the component's, not the stylesheet's: a rendering context that does
    // not apply the CSS — or a later style that re-enables the pointer for a grip —
    // would otherwise scroll the author's rows out from under a drag.
    if (editing || !scrollable) return
    const { rows, carry: rest } = wheelRows(wheelDeltaPx(e.deltaY, e.deltaMode), carry.current)
    carry.current = rest
    if (rows !== 0) setRawOffset(prev => clampScroll(table, prev + rows))
  }

  const step = (rows: number) => setRawOffset(prev => clampScroll(table, prev + rows))

  const rowPointer = (i: number): RowPointer => ({
    onEnter: () => setHovered(i),
    // Guarded on the row still being the lit one: a pointer that has already entered the
    // next row would otherwise have its own band cleared by the leave that follows it.
    onLeave: () => setHovered(prev => (prev === i ? null : prev)),
  })

  // Each band's height in px, from the one list the highlight is placed by too. Equal
  // bands unless the surface was fitted to the picture's ruling (`table.lines`).
  const bandPx = (k: number) => bandSpan(table, k).height * height

  const surface: CSSProperties = {
    left,
    top,
    width,
    height,
    transform,
    color: table.ink,
    // Lettering is sized from the *mean* band so every row reads at one size: a fitted
    // surface's bands differ by a few percent, and text that changed size row by row
    // would read as the bug it was there to hide.
    fontSize: `${rowH * table.fontScale}px`,
    // Bands are what the row count means, so the cells are sized from it rather than
    // from their contents: a tall cell would push every row below it off its line. The
    // gap above the line is the same rule applied to the one thing inside a cell that
    // can outgrow the band — a fraction of the band, resolved here rather than in the
    // stylesheet, so the arithmetic that keeps it inside is testable. These are the mean
    // band; every row restates them with its own height (see Row), which is the same
    // value everywhere unless the surface has been fitted.
    ['--cb-ptable-row' as string]: `${rowH}px`,
    ['--cb-ptable-sit' as string]: `${rowH * BAND_SIT}px`,
    // The band is washed in the authored ink. It rides as a custom property rather than
    // as `currentcolor` because the wash is a `color-mix` in the stylesheet and `color`
    // is what the lettering already spends.
    ['--cb-ptable-ink' as string]: table.ink,
    pointerEvents: editing ? 'none' : 'auto',
  }

  return (
    <div
      className={`cb-ptable-surface${editing ? ' cb-ptable-editing' : ''}`}
      style={surface}
      onWheel={onWheel}
    >
      {/* The rows are clipped to the surface. Not a scroll container — there is nothing
          to scroll, since the rows past the window were never rendered — but the
          guarantee that the surface *is* the surface: a cell that outgrew its band would
          otherwise take the rows with it off the bottom of the notepad. */}
      <div className="cb-ptable-clip">
        {/* Ahead of the table in the DOM, which is what puts the wash behind the
            lettering: the band is positioned and the table is too, so the pair paint in
            document order — the same rule that decides which picture is in front. */}
        <TableRowBand table={table} row={lit} height={height} />
        <table className="cb-ptable">
          <colgroup>
            {percents.map((pct, i) => (
              <col key={i} style={{ width: `${pct}%` }} />
            ))}
          </colgroup>
          {table.header && (
            <thead>
              <Row cells={table.columns.map(c => c.label)} aligns={aligns} bandPx={bandPx(0)} head />
            </thead>
          )}
          <tbody>
            {visibleRows(table, offset).map((cells, i) => (
              <Row
                key={i}
                cells={cells}
                aligns={aligns}
                bandPx={bandPx(rowBand(table, i))}
                pointer={i < filled ? rowPointer(i) : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>
      {/* The wheel is the gesture that was asked for and it is the only one a mouse has
          here — there is no scrollbar to drag and no scroll container to tab into. These
          two buttons are the keyboard's version of it: off-screen, real buttons (so they
          are focusable and announced), stepping the same whole rows. Without them the
          rows past the first band's worth are reachable by exactly one input device. */}
      {scrollable && !editing && (
        <div className="cb-ptable-keys">
          <button type="button" onClick={() => step(-1)}>
            Scroll table up
          </button>
          <button type="button" onClick={() => step(1)}>
            Scroll table down
          </button>
          <span aria-live="polite">
            {`Rows ${offset + 1}–${Math.min(offset + bodyRows(table), table.data.length)} of ${table.data.length}`}
          </span>
        </div>
      )}
    </div>
  )
}
