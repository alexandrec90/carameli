import { describe, expect, it } from 'vitest'

import type { CallEvent, SmsMessage } from '../../api/client'
import { formatClockTime } from '../../lib/format'
import {
  callRows,
  directionLabel,
  LIVE_TABLE_LIMIT,
  LIVE_TABLE_FEEDS,
  sameRows,
  smsRows,
  TABLE_SOURCES,
} from '../../lib/liveTables'

function makeCall(over: Partial<CallEvent> = {}): CallEvent {
  return {
    id: 'id-1',
    call_sid: 'CA1',
    direction: 'inbound',
    from_number: '+14155550000',
    to_number: '+14155550001',
    started_at: '2026-08-25T14:30:00',
    ended_at: null,
    duration_seconds: null,
    recording_url: null,
    status: 'in-progress',
    posted: false,
    created_at: '2026-08-25T14:29:58',
    ...over,
  }
}

function makeSms(over: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: 'sms-1',
    direction: 'outbound',
    from_number: '+14155550000',
    to_number: '+14155550001',
    body: 'On my way',
    message_sid: 'SM1',
    delivery_status: 'delivered',
    error_code: null,
    created_at: '2026-08-25T14:31:00',
    ...over,
  }
}

describe('formatClockTime', () => {
  it('keeps only the hour and minute', () => {
    expect(formatClockTime('2026-08-25T14:30:59')).toBe('14:30')
  })

  it('reads a space-separated timestamp too', () => {
    expect(formatClockTime('2026-08-25 09:05:00')).toBe('09:05')
  })

  it('is empty for a missing timestamp', () => {
    expect(formatClockTime(null)).toBe('')
    expect(formatClockTime('')).toBe('')
  })
})

describe('directionLabel', () => {
  it('abbreviates the two directions the app knows', () => {
    expect(directionLabel('inbound')).toBe('In')
    expect(directionLabel('OUTBOUND')).toBe('Out')
  })

  it('passes a direction it has not met through rather than blanking it', () => {
    expect(directionLabel('internal')).toBe('internal')
  })

  it('is empty for a missing direction', () => {
    expect(directionLabel(null)).toBe('')
  })
})

describe('feed shape', () => {
  it('requests enough records to exercise table scrolling', () => {
    expect(LIVE_TABLE_LIMIT).toBe(100)
  })

  it('emits one cell per declared column, for every feed', () => {
    expect(callRows([makeCall()])[0]).toHaveLength(LIVE_TABLE_FEEDS.calls.columns.length)
    expect(smsRows([makeSms()])[0]).toHaveLength(LIVE_TABLE_FEEDS.sms.columns.length)
  })

  it('declares a feed for every source', () => {
    for (const source of TABLE_SOURCES) {
      expect(LIVE_TABLE_FEEDS[source].columns.length).toBeGreaterThan(0)
      expect(LIVE_TABLE_FEEDS[source].label).not.toBe('')
    }
  })
})

describe('callRows', () => {
  it('maps a call to its remote number, start time, duration and status art', () => {
    expect(callRows([makeCall()])).toEqual([
      ['+14155550000', '14:30', '', '/comic-book/call-in-progress.webp'],
    ])
  })

  it('falls back to created_at for a call that has not started yet', () => {
    // The row exists from the first callback; started_at arrives later. A blank time on
    // the newest line is exactly the line a live table is being watched for.
    expect(callRows([makeCall({ started_at: null })])[0]?.[1]).toBe('14:29')
  })

  it('renders missing numbers and status as empty cells, not "null"', () => {
    const row = callRows([makeCall({ from_number: null, to_number: null, status: null })])[0]
    expect(row?.[0]).toBe('')
    expect(row?.[3]).toBe('/comic-book/call-failed.webp')
  })

  it('formats duration and maps terminal statuses to the matching art', () => {
    const row = callRows([
      makeCall({
        direction: 'outbound',
        status: 'completed',
        duration_seconds: 65,
      }),
    ])[0]
    expect(row).toEqual([
      '+14155550001',
      '14:30',
      '1:05',
      '/comic-book/call-ended.webp',
    ])
  })
})

describe('smsRows', () => {
  it('maps a message to time, direction, both numbers and the body', () => {
    expect(smsRows([makeSms()])).toEqual([
      ['14:31', 'Out', '+14155550000', '+14155550001', 'On my way'],
    ])
  })
})

describe('sameRows', () => {
  it('is true for equal cells in equal shapes', () => {
    expect(sameRows([['a', 'b']], [['a', 'b']])).toBe(true)
  })

  it('is false when a cell, a row length or the row count differs', () => {
    expect(sameRows([['a', 'b']], [['a', 'c']])).toBe(false)
    expect(sameRows([['a', 'b']], [['a']])).toBe(false)
    expect(sameRows([['a']], [['a'], ['b']])).toBe(false)
  })

  it('is false against nothing at all', () => {
    expect(sameRows(undefined, [])).toBe(false)
  })

  it('is true for two empty feeds', () => {
    expect(sameRows([], [])).toBe(true)
  })
})
