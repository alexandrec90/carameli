import { useState } from 'react'

import { LIVE_TABLE_FEEDS, TABLE_SOURCES } from '../../../lib/liveTables'
import { FONT_SCALE, ROW_COUNT } from '../tableData'
import { fitTableToPicture } from './fitRuledLines'
import Hint from './Hint'
import QuadCorners from './QuadCorners'
import TableColumnsInspector from './TableColumnsInspector'
import { authoredTable, coerceSource, liveTable, newTable, withRows } from './tableValidate'
import type { ImgTransform, TableProjection } from './types'
import type { EditorModeApi } from './useEditorMode'

interface TableInspectorProps {
  api: EditorModeApi
  /** Index of the selected picture, into `api.config.images`. */
  index: number
  image: ImgTransform
}

const CORNERS_HINT =
  'Drag the round blue grips onto the corners of the ruled area, then set the row count '
  + 'until the guide lines sit on the drawn ones. These fields are the same four corners '
  + 'to a tenth of a percent, which is finer than a pointer can hit and is where the '
  + 'illusion lives. Neither the guides nor the outline show outside the editor.'

const FIT_HINT =
  'Reads the ruling off the picture’s own pixels: the blue lines, the red margin line where '
  + 'there is one, and where the lines stop on the right. The corners go to that area — the '
  + 'bottom edge on the last line, the top one band above the first — the row count becomes '
  + 'the line count, and every band is placed on the line it was drawn at, so a ruling that '
  + 'is not quite evenly spaced still gets a row on every line. Retyping the row count goes '
  + 'back to equal bands; fit again after changing the picture.'

const SOURCE_HINT =
  'Either the cells typed into this surface, or a live feed. Switching either way is a '
  + 'fresh start rather than a merge, and both replace the columns — a feed’s cells are '
  + 'positional, so keeping the old headings would label every column with the wrong '
  + 'word. A feed’s rows refresh on their own: a call or a message appears on the notepad '
  + 'without reloading the page.'

/** A typed number, or the previous value when the field is mid-edit and unparseable. */
function numOr(value: string, fallback: number): number {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * The surface half of the picture inspector: whether this picture *is* a surface at all,
 * what it shows, and how many bands it is cut into.
 *
 * The switch is per picture and carries nothing about notepads — any picture can be given
 * a table, which is what makes this a projection tool rather than a notepad feature.
 *
 * The exact corner coordinates are ./QuadCorners.tsx, folded, and shared with the number
 * pad; the columns and the cells are ./TableColumnsInspector.tsx below.
 */
export default function TableInspector({ api, index, image }: TableInspectorProps) {
  const table = image.table
  // What the last fit said, shown beside its button: a count of bands, or why it found
  // none. Local, because it is about this click and not about the surface — it is not
  // saved, and a second picture starts with nothing to say.
  const [fitNote, setFitNote] = useState<string | null>(null)

  const setTable = (patch: Partial<TableProjection>) => {
    if (!table) return
    api.setImg(index, { table: { ...table, ...patch } })
  }

  /**
   * Fit the surface to the ruling drawn in the picture.
   *
   * The surface it writes into is read *after* the picture has been decoded rather than
   * captured before: the read is asynchronous, and an author who nudged a column width in
   * between would otherwise have that edit overwritten by the fit. A surface switched off
   * in the meantime is left off.
   */
  const fitToRuling = async () => {
    if (!table) return
    setFitNote('Reading the picture…')
    const result = await fitTableToPicture(image.src)
    if (!result.ok) {
      setFitNote(result.reason)
      return
    }
    const current = api.config.images[index]?.table
    if (!current) return
    api.setImg(index, { table: { ...current, ...result.fit } })
    setFitNote(`Fitted ${result.fit.rows} bands to the lines drawn in the picture.`)
  }

  /**
   * Point the surface at a live feed, or back at cells the author types.
   *
   * Each direction is a fresh start of that mode rather than a merge, and both replace
   * the columns: a feed's cells are positional, so keeping the previous headings would
   * label every column with the wrong word, and coming back off a feed to five empty
   * feed-shaped columns would leave nothing on the notepad to see.
   */
  const setSource = (value: string) => {
    if (!table) return
    const source = coerceSource(value)
    const fresh = newTable()
    api.setImg(index, {
      table: source
        ? liveTable(table, source)
        : { ...authoredTable(table), columns: fresh.columns, data: fresh.data },
    })
  }

  const toggle = (on: boolean) => {
    // Switching a surface off nulls it rather than hiding it, and switching it back on
    // starts a fresh one: keeping a stashed copy would mean a picture silently carrying
    // rows nobody can see, which is what would then get saved into layoutConfig.ts.
    api.setImg(index, {
      table: on ? newTable() : undefined,
      numberPad: on ? undefined : image.numberPad,
    })
  }

  return (
    <>
      <label className="cb-ed-check">
        <input type="checkbox" checked={!!table} onChange={e => toggle(e.target.checked)} />
        <span>Project a table on this picture</span>
      </label>

      {table && (
        <>
          <div className="cb-ed-row">
            <label className="cb-ed-field">
              <span>shows</span>
              <select
                className="cb-ed-select"
                value={table.source ?? ''}
                onChange={e => setSource(e.target.value)}
              >
                <option value="">Cells typed below</option>
                {TABLE_SOURCES.map(s => (
                  <option key={s} value={s}>{LIVE_TABLE_FEEDS[s].label}</option>
                ))}
              </select>
            </label>
            <Hint text={SOURCE_HINT} />
          </div>

          <div className="cb-ed-row">
            <label className="cb-ed-field">
              <span>rows</span>
              <input
                className="cb-ed-input"
                type="number"
                min={ROW_COUNT.min}
                max={ROW_COUNT.max}
                step="1"
                value={table.rows}
                // A typed count is a request for equal bands: a fitted ruling is for the
                // count it was measured at, so it goes with the old number (`withRows`).
                onChange={e =>
                  api.setImg(index, { table: withRows(table, Math.round(numOr(e.target.value, table.rows))) })
                }
              />
            </label>
            <label className="cb-ed-field">
              <span>text</span>
              <input
                type="range"
                min={FONT_SCALE.min}
                max={FONT_SCALE.max}
                step={FONT_SCALE.step}
                value={table.fontScale}
                onChange={e => setTable({ fontScale: numOr(e.target.value, table.fontScale) })}
              />
            </label>
            <label className="cb-ed-field">
              <span>ink</span>
              <input
                type="color"
                value={table.ink}
                onChange={e => setTable({ ink: e.target.value })}
              />
            </label>
          </div>

          <label className="cb-ed-check">
            <input
              type="checkbox"
              checked={table.header}
              onChange={e => setTable({ header: e.target.checked })}
            />
            <span>First row is the column headings</span>
          </label>

          {/* The fit is the whole of "line the table up" for a picture that carries
              ruling, so it sits ahead of the folded corner fields rather than inside
              them: the fields are for the last tenth of a percent, this is for the rest. */}
          <div className="cb-ed-row">
            <button
              type="button"
              className="cb-ed-btn"
              title="Put the corners on the ruled area and a band on every drawn line"
              onClick={() => { void fitToRuling() }}
            >
              Fit to ruled lines
            </button>
            <Hint text={FIT_HINT} />
          </div>
          {fitNote !== null && (
            <p className="cb-ed-fit-note" role="status">
              {fitNote}
            </p>
          )}

          <QuadCorners
            quad={table.quad}
            onChange={quad => setTable({ quad })}
            hint={CORNERS_HINT}
            resetLabel="Reset corners"
            resetTitle="Put the four corners back on the picture, square"
          />

          {/* Keyed by picture so the cell block's in-progress text does not follow the
              selection onto a different surface. */}
          <TableColumnsInspector key={index} api={api} index={index} table={table} />
        </>
      )}
    </>
  )
}
