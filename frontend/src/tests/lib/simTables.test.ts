import { describe, expect, it } from 'vitest'

import { LIVE_TABLE_FEEDS, LIVE_TABLE_LIMIT, TABLE_SOURCES } from '../../lib/liveTables'
import { simCalls, simCallSummary, simFeedRows, simMessages } from '../../lib/simTables'

describe('simCallSummary', () => {
  it.each(['extension', 'number'] as const)('accounts for every call by %s', groupBy => {
    const rows = simCallSummary(groupBy)
    expect(rows.reduce((sum, row) => sum + row.call_count, 0)).toBe(LIVE_TABLE_LIMIT)
    expect(new Set(rows.map(row => row.group_key)).size).toBe(rows.length)
  })

  it('counts answered calls and rolls up their talk time', () => {
    const answered = simCalls().filter(call => call.status === 'completed')
    const rows = simCallSummary('extension')
    expect(rows.reduce((sum, row) => sum + row.answered_count, 0)).toBe(answered.length)
    expect(rows.reduce((sum, row) => sum + row.total_duration_seconds, 0)).toBe(
      answered.reduce((sum, call) => sum + (call.duration_seconds ?? 0), 0),
    )
  })

  it('reports the success rate as a ratio', () => {
    for (const row of simCallSummary('number')) {
      expect(row.success_rate).toBe(row.answered_count / row.call_count)
    }
  })
})

describe('simMessages', () => {
  it('gives every message its own id, newest first', () => {
    const messages = simMessages()
    expect(new Set(messages.map(m => m.id)).size).toBe(messages.length)
    expect(messages[0].created_at > messages[1].created_at).toBe(true)
  })
})

describe('simFeedRows', () => {
  it('fills a surface with as many rows as a real feed asks for', () => {
    expect(simFeedRows('calls')).toHaveLength(LIVE_TABLE_LIMIT)
    expect(simFeedRows('sms')).toHaveLength(LIVE_TABLE_LIMIT)
  })

  // The whole point of building rows out of records and running them through the feed's own
  // mapper: a column added to a feed reaches the made-up rows for free, and no cell can
  // drift out from under its heading.
  it.each(TABLE_SOURCES)('emits one cell per column of the %s feed', source => {
    const width = LIVE_TABLE_FEEDS[source].columns.length
    for (const row of simFeedRows(source)) expect(row).toHaveLength(width)
  })

  it('is deterministic, so the answer can be memoized and handed back by identity', () => {
    expect(simFeedRows('calls')).toEqual(simFeedRows('calls'))
    expect(simFeedRows('sms')).toEqual(simFeedRows('sms'))
  })

  it('scrolls: the rows differ from each other rather than repeating one record', () => {
    const first = simFeedRows('calls').map(r => r.join('|'))
    expect(new Set(first).size).toBe(first.length)
  })

  it('honours a smaller count, and treats a negative one as none', () => {
    expect(simFeedRows('sms', 3)).toHaveLength(3)
    expect(simFeedRows('sms', -1)).toEqual([])
  })

  it('leaves the duration blank on a call that never connected', () => {
    const durations = simFeedRows('calls').map(r => r[2])
    expect(durations).toContain('')
    expect(durations.some(d => d !== '')).toBe(true)
  })
})
