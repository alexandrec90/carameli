import { LIVE_TABLE_FEEDS, TABLE_SOURCES } from '../../../lib/liveTables'
import { FONT_SCALE, ROW_COUNT } from '../tableData'
import Hint from './Hint'
import QuadCorners from './QuadCorners'
import TableColumnsInspector from './TableColumnsInspector'
import { authoredTable, coerceSource, liveTable, newTable } from './tableValidate'
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

  const setTable = (patch: Partial<TableProjection>) => {
    if (!table) return
    api.setImg(index, { table: { ...table, ...patch } })
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
                onChange={e => setTable({ rows: Math.round(numOr(e.target.value, table.rows)) })}
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
