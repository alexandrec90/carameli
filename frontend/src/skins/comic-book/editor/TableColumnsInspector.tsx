import { useState } from 'react'

import { LIVE_TABLE_FEEDS } from '../../../lib/liveTables'
import { fitColumns, formatRows, parseRows } from '../tableData'
import Hint from './Hint'
import Section from './Section'
import type { TableColumn, TableProjection } from './types'
import type { EditorModeApi } from './useEditorMode'

interface TableColumnsInspectorProps {
  api: EditorModeApi
  /** Index of the picture the surface belongs to, into `api.config.images`. */
  index: number
  table: TableProjection
}

const ALIGNS: TableColumn['align'][] = ['left', 'center', 'right']

/** How much of the surface a brand-new column asks for, relative to the ones there. */
const NEW_COLUMN: TableColumn = { label: 'Column', width: 1, align: 'left' }

const COLUMNS_HINT =
  'The headings, their share of the width, and how each column is set. On a live surface '
  + 'the list itself is the feed’s — its cells are positional, so removing one would not '
  + 'remove that value, it would slide every value one heading to the left — but the '
  + 'widths, the alignment and the wording stay yours.'

const CELLS_HINT =
  'One row per line, cells split on a tab or a |. Paste straight out of a spreadsheet: '
  + 'every row is padded or trimmed to the column count on the way in, so a ragged row '
  + 'cannot put a cell under the wrong heading.'

const WINDOW_HINT =
  'Only the band count is on screen at once; the wheel moves the rest through, a whole '
  + 'row at a time.'

/**
 * The columns of a projected surface and the cells that go in them.
 *
 * Cells are authored here, in the config, the way a speech bubble's words are — a surface
 * is part of the page's composition, so its rows belong in `layoutConfig.ts` beside the
 * framing that lands them on the drawn lines, and both arrive in the same reviewable diff.
 *
 * The block is edited as text rather than as a grid of inputs because the way rows
 * actually get in here is a paste out of a spreadsheet. Columns split on a tab or a `|`,
 * so both a paste and hand-typing work, and every row is padded or trimmed to the column
 * count on the way in — a ragged row would put a cell under the wrong heading.
 */
export default function TableColumnsInspector({ api, index, table }: TableColumnsInspectorProps) {
  // The raw text while the field has focus. Without it, every keystroke would be parsed
  // and re-formatted under the cursor, so a half-typed row would lose its blank line and
  // gain the spaces around its pipes as they were typed.
  const [draft, setDraft] = useState<string | null>(null)

  const setTable = (patch: Partial<TableProjection>) => {
    api.setImg(index, { table: { ...table, ...patch } })
  }

  /** Replace the column list, re-shaping every row to match it. */
  const setColumns = (columns: TableColumn[]) => {
    const cols = columns.length > 0 ? columns : [NEW_COLUMN]
    setTable({ columns: cols, data: fitColumns(table.data, cols.length) })
  }

  const patchColumn = (i: number, patch: Partial<TableColumn>) => {
    setColumns(table.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  }

  const onData = (text: string) => {
    setDraft(text)
    setTable({ data: parseRows(text, table.columns.length) })
  }

  return (
    // Folded: three fields per column and a six-row cell box is the biggest single block
    // the inspector can hold, and it is a paste-once block — see ./Section.tsx.
    <Section title="columns & rows" hint={COLUMNS_HINT}>
      {table.columns.map((c, i) => (
        <div className="cb-ed-row" key={i}>
          <label className="cb-ed-field">
            <span>heading</span>
            <input
              className="cb-ed-input"
              type="text"
              value={c.label}
              onChange={e => patchColumn(i, { label: e.target.value })}
            />
          </label>
          <label className="cb-ed-field">
            <span>width</span>
            <input
              className="cb-ed-input"
              type="number"
              min="0.1"
              step="0.1"
              value={c.width}
              onChange={e => {
                const n = Number.parseFloat(e.target.value)
                patchColumn(i, { width: Number.isFinite(n) ? n : c.width })
              }}
            />
          </label>
          <label className="cb-ed-field">
            <span>align</span>
            <select
              className="cb-ed-select"
              value={c.align}
              onChange={e => patchColumn(i, { align: e.target.value as TableColumn['align'] })}
            >
              {ALIGNS.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
          {/* A feed's cells are positional — the mapper emits them in the order the feed
              declares its columns — so removing the second column of a live surface would
              not remove that value, it would slide every value one heading to the left.
              The column list is the feed's while a feed is on; only its widths, alignments
              and wording are the author's. */}
          {!table.source && (
            <button
              type="button"
              className="cb-ed-btn cb-ed-btn-danger"
              title={`Remove the ${c.label || `column ${i + 1}`} column`}
              disabled={table.columns.length < 2}
              onClick={() => setColumns(table.columns.filter((_, j) => j !== i))}
            >
              −
            </button>
          )}
        </div>
      ))}

      {!table.source && (
        <button
          type="button"
          className="cb-ed-btn"
          onClick={() => setColumns([...table.columns, { ...NEW_COLUMN }])}
        >
          + Column
        </button>
      )}

      {/* No cell block for a live surface: its rows are records, so a textarea here would
          be inviting the author to type into a table that is about to overwrite them. The
          columns above stay editable — widths and alignment are how a feed is fitted to
          the ruling in the photograph, and renaming a heading is the author's business. */}
      {table.source ? (
        <div className="cb-ed-hint">
          Live {LIVE_TABLE_FEEDS[table.source].label.toLowerCase()}, newest first{' '}
          <Hint text={`Rows come from the live records and refresh on their own. ${WINDOW_HINT}`} />
        </div>
      ) : (
        <>
          <div className="cb-ed-row">
            <label className="cb-ed-field">
              <span>rows</span>
              <textarea
                className="cb-ed-textarea"
                rows={6}
                spellCheck={false}
                value={draft ?? formatRows(table.data)}
                placeholder="Ada Lovelace | 555-0101"
                onChange={e => onData(e.target.value)}
                onBlur={() => setDraft(null)}
              />
            </label>
            <Hint text={CELLS_HINT} />
          </div>
          <div className="cb-ed-hint">
            {table.data.length} row{table.data.length === 1 ? '' : 's'} of data{' '}
            <Hint text={WINDOW_HINT} />
          </div>
        </>
      )}
    </Section>
  )
}
