import { useRef, useState } from 'react'
import type { CSSProperties, WheelEvent as ReactWheelEvent } from 'react'

import type { TableProjection } from './editor/types'
import {
  BAND_SIT,
  bodyRows,
  clampScroll,
  columnPercents,
  maxScroll,
  STATUS_BAND,
  visibleRows,
  wheelDeltaPx,
  wheelRows,
} from './tableData'
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

/** A row's worth of cells, or the heading row. */
function Row({
  cells,
  aligns,
  head,
}: {
  cells: string[]
  aligns: TableProjection['columns'][number]['align'][]
  head?: boolean
}) {
  const Cell = head ? 'th' : 'td'
  return (
    <tr>
      {cells.map((text, i) => {
        const isStatusArt = text.startsWith('/comic-book/call-')
        return (
          <Cell key={i} className="cb-ptable-cell" style={{ textAlign: aligns[i] ?? 'left' }}>
            {isStatusArt ? (
              <img
                className="cb-ptable-status"
                src={text}
                alt={text.includes('in-progress') ? 'Call in progress' : text.includes('failed') ? 'Call failed' : 'Call ended'}
              />
            ) : (
              text
            )}
          </Cell>
        )
      })}
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

  const surface: CSSProperties = {
    left,
    top,
    width,
    height,
    transform,
    color: table.ink,
    fontSize: `${rowH * table.fontScale}px`,
    // Bands are what the row count means, so the cells are sized from it rather than
    // from their contents: a tall cell would push every row below it off its line.
    // The two below are the same rule applied to the two things inside a cell that can
    // be taller than the band and grow it — the gap above the line, and a status
    // illustration. Both are fractions of the band, resolved here rather than in the
    // stylesheet, so the arithmetic that keeps them inside it is testable.
    ['--cb-ptable-row' as string]: `${rowH}px`,
    ['--cb-ptable-sit' as string]: `${rowH * BAND_SIT}px`,
    ['--cb-ptable-art' as string]: `${rowH * STATUS_BAND}px`,
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
        <table className="cb-ptable">
          <colgroup>
            {percents.map((pct, i) => (
              <col key={i} style={{ width: `${pct}%` }} />
            ))}
          </colgroup>
          {table.header && (
            <thead>
              <Row cells={table.columns.map(c => c.label)} aligns={aligns} head />
            </thead>
          )}
          <tbody>
            {visibleRows(table, offset).map((cells, i) => (
              <Row key={i} cells={cells} aligns={aligns} />
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
