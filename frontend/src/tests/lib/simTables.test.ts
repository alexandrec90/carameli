import { afterEach, describe, expect, it, vi } from 'vitest'

import { LIVE_TABLE_FEEDS, LIVE_TABLE_LIMIT, TABLE_SOURCES } from '../../lib/liveTables'
import { detectSimTables, resolveSimFlag, simFeedRows } from '../../lib/simTables'

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const FLAG_KEY = 'live-tables:sim'

/** Put the tab on a URL, the way `?sim=1` reaches `detectSimTables`. */
function visit(search: string) {
  window.history.replaceState({}, '', `/${search}`)
}

describe('resolveSimFlag', () => {
  it('switches on from the query string and remembers it', () => {
    expect(resolveSimFlag('1', null)).toEqual({ active: true, storedFlag: '1' })
  })

  // The off switch has to clear the flag rather than merely returning false: the query
  // string is gone on the next client-side navigation, and a flag left set would turn the
  // made-up rows back on at the first link.
  it('switches off from the query string and forgets it', () => {
    expect(resolveSimFlag('0', '1')).toEqual({ active: false, storedFlag: null })
  })

  it('stays on across a load with no parameter at all', () => {
    expect(resolveSimFlag(null, '1')).toEqual({ active: true, storedFlag: '1' })
  })

  it('is off by default, and stores nothing for a tab that never asked', () => {
    expect(resolveSimFlag(null, null)).toEqual({ active: false, storedFlag: null })
  })

  it('reads a stored value that is not the flag as off', () => {
    expect(resolveSimFlag(null, 'yes')).toEqual({ active: false, storedFlag: null })
  })
})

describe('detectSimTables', () => {
  afterEach(() => {
    window.localStorage.clear()
    visit('')
  })

  it('persists the flag so it survives navigation away from ?sim=1', () => {
    visit('?sim=1')
    expect(detectSimTables()).toBe(true)
    visit('')
    expect(window.localStorage.getItem(FLAG_KEY)).toBe('1')
    expect(detectSimTables()).toBe(true)
  })

  it('clears the stored flag on ?sim=0', () => {
    window.localStorage.setItem(FLAG_KEY, '1')
    visit('?sim=0')
    expect(detectSimTables()).toBe(false)
    expect(window.localStorage.getItem(FLAG_KEY)).toBeNull()
  })

  // A tab with storage denied still gets the preview it asked for in the address bar; only
  // the memory of it is lost, which is the half that can fail.
  it('still honours the query string when localStorage throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    visit('?sim=1')
    expect(detectSimTables()).toBe(true)
    getItem.mockRestore()
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

  it('is deterministic, so the poll-free answer can be handed back by identity', () => {
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
