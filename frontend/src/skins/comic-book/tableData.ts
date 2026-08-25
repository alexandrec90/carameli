import type { TableColumn, TableProjection } from './editor/types'

// The *contents* of a projected table: how many rows fit, which ones are on screen, how
// wide each column is, and how a block of pasted text becomes cells. Pure, so the
// scroll behaviour that has to land on the same lines every time is testable without a
// browser.

/** Wheel travel, in px, that advances the table by one row. One notch on a mouse. */
export const WHEEL_ROW_PX = 100

/** Row-count bounds offered by the editor. Two rows is the least that reads as a table. */
export const ROW_COUNT = { min: 2, max: 60 }

/** Lettering height as a fraction of a row's height. */
export const FONT_SCALE = { min: 0.2, max: 1, step: 0.05 }

/**
 * Row slots the data gets. The heading, when there is one, takes the first slot rather
 * than sitting above the surface — the whole point of the row count is that every slot
 * lands on a line drawn in the picture, and a heading floating between two of them is
 * the one thing that would give the projection away.
 */
export function bodyRows(t: Pick<TableProjection, 'rows' | 'header'>): number {
  return Math.max(0, Math.floor(t.rows) - (t.header ? 1 : 0))
}

/** How far the table can be scrolled: 0 when everything already fits. */
export function maxScroll(t: Pick<TableProjection, 'rows' | 'header' | 'data'>): number {
  return Math.max(0, t.data.length - bodyRows(t))
}

/** Pull a scroll offset back into range — after a wheel, a row-count change, or a paste. */
export function clampScroll(
  t: Pick<TableProjection, 'rows' | 'header' | 'data'>,
  offset: number,
): number {
  if (!Number.isFinite(offset)) return 0
  return Math.min(Math.max(Math.round(offset), 0), maxScroll(t))
}

/**
 * Advance the scroll by whole rows.
 *
 * Whole rows is the entire mechanism behind "rows always line up": the offset is an
 * integer index into the data, never a pixel position, so slot *k* is at exactly the
 * same place on the surface at every offset. A pixel scroll with snapping applied
 * afterwards would drift the same lines by a subpixel per notch and read as the table
 * sliding off the notepad.
 */
export function scrollByRows(
  t: Pick<TableProjection, 'rows' | 'header' | 'data'>,
  offset: number,
  rows: number,
): number {
  return clampScroll(t, offset + rows)
}

/**
 * Wheel travel in px → whole rows moved, plus the travel left over.
 *
 * The remainder is carried by the caller rather than discarded so a trackpad, which
 * emits a dozen small deltas where a mouse emits one of 100, still moves the table.
 */
export function wheelRows(deltaPx: number, carried: number): { rows: number; carry: number } {
  const total = carried + deltaPx
  const rows = Math.trunc(total / WHEEL_ROW_PX)
  return { rows, carry: total - rows * WHEEL_ROW_PX }
}

/** A wheel event's travel in px, whatever unit the browser reported it in. */
export function wheelDeltaPx(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * 16 // DOM_DELTA_LINE
  if (deltaMode === 2) return deltaY * 400 // DOM_DELTA_PAGE
  return deltaY
}

/**
 * The data rows on screen at `offset`, padded to the available slots with empty rows.
 *
 * Padding rather than stopping short keeps the surface the same height whatever the data
 * does: a short table that rendered only its own rows would leave the ruled lines below
 * it uncovered on some pages and not others.
 */
export function visibleRows(
  t: Pick<TableProjection, 'rows' | 'header' | 'data' | 'columns'>,
  offset: number,
): string[][] {
  const slots = bodyRows(t)
  const start = clampScroll(t, offset)
  const out: string[][] = []
  for (let i = 0; i < slots; i++) {
    const row = t.data[start + i] ?? []
    out.push(t.columns.map((_, c) => row[c] ?? ''))
  }
  return out
}

/**
 * Column widths as percentages summing to 100, from the author's weights.
 *
 * Weights rather than percentages in the config because adding a column to a set that
 * already sums to 100 otherwise means retyping every one of them.
 */
export function columnPercents(columns: TableColumn[]): number[] {
  const weights = columns.map(c => (Number.isFinite(c.width) && c.width > 0 ? c.width : 1))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return columns.map(() => 100 / Math.max(1, columns.length))
  return weights.map(w => (w / total) * 100)
}

/**
 * A pasted block of text as cells: one row per line, columns split on tab or `|`.
 *
 * Both separators, because the two ways an author actually gets rows in here are a paste
 * out of a spreadsheet (tabs) and typing them by hand (pipes, which are visible). Rows
 * are padded and truncated to `colCount` so the grid stays rectangular — a ragged row
 * would put a cell under the wrong heading.
 */
export function parseRows(text: string, colCount: number): string[][] {
  const cols = Math.max(1, colCount)
  return text
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.trim() !== '')
    .map(line => {
      const cells = line.split(line.includes('\t') ? '\t' : '|').map(c => c.trim())
      return Array.from({ length: cols }, (_, i) => cells[i] ?? '')
    })
}

/** Cells back to the editable block {@link parseRows} reads. Pipes: a tab is invisible. */
export function formatRows(rows: string[][]): string {
  return rows.map(r => r.join(' | ')).join('\n')
}

/** Re-shape every row to `colCount` cells, after a column is added or removed. */
export function fitColumns(rows: string[][], colCount: number): string[][] {
  const cols = Math.max(1, colCount)
  return rows.map(r => Array.from({ length: cols }, (_, i) => r[i] ?? ''))
}
