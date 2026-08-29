import type { CallEvent, SmsMessage } from '../api/client'
import { formatClockTime, formatDuration } from './format'

/**
 * The record feeds a table can be pointed at, and the shape each one arrives in.
 *
 * Pure and React-free on purpose: this is the *contract* between the hook that fetches
 * (`hooks/useLiveTables.ts`) and the surface that draws (the comic-book skin's projected
 * tables). Both need the column headings — one to seed them when an author picks a feed,
 * the other to fill cells under them — and neither should own them, because a heading
 * that disagreed with the cell beneath it is the one failure a table cannot show.
 */

/** Every feed a table may be wired to. Absence of a source means authored cells. */
export const TABLE_SOURCES = ['calls', 'sms'] as const

export type TableSource = (typeof TABLE_SOURCES)[number]

/**
 * A column of a live feed. Structurally the skin's `TableColumn`, restated here rather
 * than imported: `lib/` is shared by every skin and must not depend on one of them.
 */
export interface LiveTableColumn {
  label: string
  /** Share of the surface's width, as a weight against the other columns. */
  width: number
  align: 'left' | 'center' | 'right'
}

export interface LiveTableFeed {
  /** What the editor's source dropdown calls this feed. */
  label: string
  /** Headings and proportions, index-parallel to the cells the mapper emits. */
  columns: LiveTableColumn[]
}

/**
 * How many records a feed asks for.
 *
 * Far more than any surface shows at once — a notepad is eight ruled lines — because the
 * rows past the window are what the wheel scrolls through. Not so many that a poll every
 * few seconds becomes a page of history nobody reads.
 */
export const LIVE_TABLE_LIMIT = 100

/**
 * The call log is deliberately compact: the remote number, start time, duration and a
 * status illustration. The image path is a cell value so the projected table stays a
 * generic renderer while this feed can use the comic-book artwork.
 */
const CALL_COLUMNS: LiveTableColumn[] = [
  { label: 'Number', width: 2, align: 'left' },
  { label: 'Start time', width: 1.4, align: 'left' },
  { label: 'Duration', width: 1, align: 'left' },
  { label: 'Status', width: 0.7, align: 'center' },
]

const SMS_COLUMNS: LiveTableColumn[] = [
  { label: 'Time', width: 1, align: 'left' },
  { label: 'Dir', width: 0.7, align: 'left' },
  { label: 'From', width: 1.8, align: 'left' },
  { label: 'To', width: 1.8, align: 'left' },
  { label: 'Message', width: 3, align: 'left' },
]

export const LIVE_TABLE_FEEDS: Record<TableSource, LiveTableFeed> = {
  calls: { label: 'Call records', columns: CALL_COLUMNS },
  sms: { label: 'SMS messages', columns: SMS_COLUMNS },
}

/**
 * `inbound` / `outbound` as two or three letters.
 *
 * A projected surface is a photograph's worth of width, and a column wide enough for
 * `outbound` is a column taken off `From` and `To`, which are the cells a reader is
 * actually looking for. Any other value passes through rather than being blanked — a
 * direction this app has not met yet is still worth showing.
 */
export function directionLabel(direction: string | null): string {
  const d = (direction ?? '').toLowerCase()
  if (d === 'inbound') return 'In'
  if (d === 'outbound') return 'Out'
  return direction ?? ''
}

export const CALL_STATUS_ART = {
  ended: '/comic-book/call-ended.webp',
  failed: '/comic-book/call-failed.webp',
  inProgress: '/comic-book/call-in-progress.webp',
} as const

function statusArt(status: string | null): string {
  const normalized = (status ?? '').toLowerCase()
  if (normalized === 'completed') return CALL_STATUS_ART.ended
  if (normalized === 'ringing' || normalized === 'in-progress') return CALL_STATUS_ART.inProgress
  return CALL_STATUS_ART.failed
}

/** Call records as cells, index-parallel to {@link CALL_COLUMNS}. */
export function callRows(events: CallEvent[]): string[][] {
  return events.map(e => [
    e.direction.toLowerCase() === 'outbound' ? e.to_number ?? '' : e.from_number ?? '',
    formatClockTime(e.started_at ?? e.created_at),
    formatDuration(e.duration_seconds),
    statusArt(e.status),
  ])
}

/** SMS messages as cells, index-parallel to {@link SMS_COLUMNS}. */
export function smsRows(messages: SmsMessage[]): string[][] {
  return messages.map(m => [
    formatClockTime(m.created_at),
    directionLabel(m.direction),
    m.from_number ?? '',
    m.to_number ?? '',
    m.body ?? '',
  ])
}

/**
 * Whether two polls produced the same cells.
 *
 * The poll runs whether or not anything happened, and a fresh array every few seconds
 * would re-render every panel on the page — canvases, bubbles and all — for a notepad
 * that says exactly what it said before. Comparing the cells is what lets the caller
 * hand back the identical array and re-render nothing.
 */
export function sameRows(a: string[][] | undefined, b: string[][]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((row, i) => {
    const other = b[i]
    return !!other && row.length === other.length && row.every((cell, j) => cell === other[j])
  })
}
