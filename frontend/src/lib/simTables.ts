import type { CallEvent, SmsMessage } from '../api/client'
import { logger } from './logger'
import { callRows, LIVE_TABLE_LIMIT, smsRows, type TableSource } from './liveTables'

/**
 * Made-up records for the live feeds, so a surface can be framed against a full table.
 *
 * A projected table is drawn on a photograph and scrolled a row at a time, and both of
 * those are only judgeable against enough rows to fill the window and overflow it. A
 * development database holds two calls and no messages, so the notepad an author is
 * lining up is three lines long and the wheel does nothing — which is exactly the state
 * in which every decision about band height, ink and column width has to be made.
 *
 * `?sim=1` fills every live surface on the page with {@link LIVE_TABLE_LIMIT} rows
 * instead, the same number a real feed asks for, and `?sim=0` puts the real feed back.
 * **It is dev-only**, on the same terms as the editor: fabricated call history on a page
 * a customer can reach is a support call, not a preview.
 *
 * The rows are built as records and run through the feed's own mapper rather than written
 * out as cells. That is what keeps them index-parallel to the columns for free — a feed
 * that gains or loses a column changes these too, and there is no second list to update.
 */

const FLAG_KEY = 'live-tables:sim'

/**
 * Resolve the simulation flag for this load. `?sim=1` switches it on and `?sim=0` off;
 * either way `storedFlag` is what the persisted flag should become (`null` = removed) so
 * the outcome survives client-side navigation, which drops the query string.
 *
 * Deliberately the same shape as the editor's `resolveEditFlag`: they are two dev toggles
 * an author flips in the same address bar, and a second spelling of "on" would be one to
 * remember.
 */
export function resolveSimFlag(
  param: string | null,
  stored: string | null,
): { active: boolean; storedFlag: '1' | null } {
  if (param === '1') return { active: true, storedFlag: '1' }
  if (param === '0') return { active: false, storedFlag: null }
  const active = stored === '1'
  return { active, storedFlag: active ? '1' : null }
}

/** True when live surfaces should show made-up rows for this load. Persists the outcome. */
export function detectSimTables(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  const param = new URLSearchParams(window.location.search).get('sim')
  try {
    const stored = window.localStorage.getItem(FLAG_KEY)
    const { active, storedFlag } = resolveSimFlag(param, stored)
    if (storedFlag !== stored) {
      if (storedFlag === null) window.localStorage.removeItem(FLAG_KEY)
      else window.localStorage.setItem(FLAG_KEY, storedFlag)
    }
    return active
  } catch (err) {
    logger.warn('Could not persist live-table simulation flag', { key: FLAG_KEY, err: String(err) })
    return resolveSimFlag(param, null).active
  }
}

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
    from_number: outbound ? '+14388762750' : simNumber(i),
    to_number: outbound ? simNumber(i) : '+14388762750',
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
    from_number: outbound ? '+14388762750' : simNumber(i),
    to_number: outbound ? simNumber(i) : '+14388762750',
    body: BODIES[i % BODIES.length],
    message_sid: `SM${String(i).padStart(6, '0')}`,
    delivery_status: 'delivered',
    error_code: null,
    created_at: simStamp(i),
  }
}

/**
 * `count` made-up rows for `source`, newest first — the order a real feed arrives in.
 *
 * Pure and deterministic: index 7 is the same record on every call, so the poll-free
 * simulated answer can be memoized and handed back by identity like a quiet poll's.
 */
export function simFeedRows(source: TableSource, count: number = LIVE_TABLE_LIMIT): string[][] {
  const indexes = Array.from({ length: Math.max(0, count) }, (_, i) => i)
  return source === 'calls' ? callRows(indexes.map(simCall)) : smsRows(indexes.map(simSms))
}
