import type { CallEvent, CallSummaryGroupBy, CallSummaryRow, SmsMessage } from '../api/client'
import { callRows, LIVE_TABLE_LIMIT, smsRows, type TableSource } from './liveTables'

/**
 * The made-up call and SMS records behind every table in the app.
 *
 * A projected table is drawn on a photograph and scrolled a row at a time, and both of
 * those are only judgeable against enough rows to fill the window and overflow it, so a
 * feed is always {@link LIVE_TABLE_LIMIT} rows. `api/client.ts` serves the same records
 * to the Call Events, SMS and CDR Summary pages.
 *
 * The rows are built as records and run through the feed's own mapper rather than written
 * out as cells. That is what keeps them index-parallel to the columns for free — a feed
 * that gains or loses a column changes these too, and there is no second list to update.
 */

/** The account's own number on every made-up record, and its one phone line. */
export const SIM_LINE = '+14388762750'

/**
 * The instant the made-up log ends. A fixed one rather than `Date.now()`: two calls a
 * second apart must produce the identical cells, because the hook hands its answer
 * straight to the page and a fresh array would repaint every panel on it.
 */
const LATEST_MS = Date.parse('2026-08-31T16:42:00Z')

/** Gap between one record and the next. Not a round number, so the clock column reads as a log rather than as a ruler. */
const STEP_MS = 7 * 60_000 + 13_000

/** Cycled by index — lengths chosen coprime so the columns do not repeat as one block. */
const STATUSES = ['completed', 'completed', 'in-progress', 'failed', 'completed', 'ringing', 'no-answer']
const SECONDS: (number | null)[] = [42, 187, 8, null, 613, 95, 1274, 26, 331, 5, 76]
const BODIES = [
  'On my way, ten minutes out.',
  'Can you resend that invoice?',
  'Confirmed for Thursday at 2.',
  'The line was busy, trying again.',
  'Thanks - got it.',
  'Call me when you are free.',
  'Voicemail is full again.',
  'New number, saving it now.',
  'Sorry, wrong number.',
  'Meeting moved to the morning.',
  'Yes, that works.',
  'Package delivered to the front desk.',
  'No answer, will try after lunch.',
]

/** `+1415555xxxx`, spread so no two neighbouring rows read as the same caller. */
function simNumber(i: number): string {
  return `+1415555${String(1000 + (i * 37) % 9000).padStart(4, '0')}`
}

/** Seconds-precision local-style ISO, which is the shape `formatClockTime` slices. */
function simStamp(i: number): string {
  return new Date(LATEST_MS - i * STEP_MS).toISOString().slice(0, 19)
}

function simCall(i: number): CallEvent {
  const status = STATUSES[i % STATUSES.length]
  const outbound = i % 3 === 0
  const stamp = simStamp(i)
  return {
    id: `sim-call-${i}`,
    call_sid: `CA${String(i).padStart(6, '0')}`,
    direction: outbound ? 'outbound' : 'inbound',
    from_number: outbound ? SIM_LINE : simNumber(i),
    to_number: outbound ? simNumber(i) : SIM_LINE,
    started_at: stamp,
    ended_at: status === 'completed' ? stamp : null,
    // A call that never connected has no duration, and the blank cell under a row that is
    // still ringing is a state the framing has to look right with.
    duration_seconds: status === 'completed' ? SECONDS[i % SECONDS.length] : null,
    recording_url: null,
    status,
    posted: false,
    created_at: stamp,
  }
}

function simSms(i: number): SmsMessage {
  const outbound = i % 2 === 0
  return {
    id: `sim-sms-${i}`,
    direction: outbound ? 'outbound' : 'inbound',
    from_number: outbound ? SIM_LINE : simNumber(i),
    to_number: outbound ? simNumber(i) : SIM_LINE,
    body: BODIES[i % BODIES.length],
    message_sid: `SM${String(i).padStart(6, '0')}`,
    delivery_status: 'delivered',
    error_code: null,
    created_at: simStamp(i),
  }
}

function indexes(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => i)
}

/** `count` made-up call records, newest first. */
export function simCalls(count: number = LIVE_TABLE_LIMIT): CallEvent[] {
  return indexes(count).map(simCall)
}

/** `count` made-up SMS records, newest first. */
export function simMessages(count: number = LIVE_TABLE_LIMIT): SmsMessage[] {
  return indexes(count).map(simSms)
}

/**
 * `count` made-up rows for `source`, newest first.
 *
 * Pure and deterministic: index 7 is the same record on every call, so the answer can be
 * memoized and handed back by identity.
 */
export function simFeedRows(source: TableSource, count: number = LIVE_TABLE_LIMIT): string[][] {
  return source === 'calls' ? callRows(simCalls(count)) : smsRows(simMessages(count))
}

/** How many distinct extensions and numbers the made-up log is grouped into. */
const SUMMARY_GROUPS = 6

/** The made-up log rolled up for the CDR Summary page. */
export function simCallSummary(groupBy: CallSummaryGroupBy): CallSummaryRow[] {
  const groups = new Map<string, CallEvent[]>()
  simCalls().forEach((call, i) => {
    const bucket = i % SUMMARY_GROUPS
    const key = groupBy === 'extension' ? String(101 + bucket) : simNumber(bucket)
    groups.set(key, [...(groups.get(key) ?? []), call])
  })
  return [...groups].map(([group_key, calls]) => {
    const answered = calls.filter(call => call.status === 'completed')
    const total = answered.reduce((sum, call) => sum + (call.duration_seconds ?? 0), 0)
    return {
      group_key,
      call_count: calls.length,
      answered_count: answered.length,
      total_duration_seconds: total,
      avg_duration_seconds: Math.round(total / Math.max(1, answered.length)),
      success_rate: answered.length / calls.length,
    }
  })
}
