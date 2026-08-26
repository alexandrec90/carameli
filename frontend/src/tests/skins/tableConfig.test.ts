import { describe, expect, it } from 'vitest'

import { LIVE_TABLE_FEEDS } from '../../lib/liveTables'
import { cloneConfig, seedConfig } from '../../skins/comic-book/editor/configSeed'
import { hydrateConfig } from '../../skins/comic-book/editor/configHydrate'
import { serializeTable, tableSuffix } from '../../skins/comic-book/editor/serializeTable'
import {
  authoredTable,
  cloneTable,
  coerceQuad,
  coerceSource,
  coerceTable,
  liveTable,
  newTable,
} from '../../skins/comic-book/editor/tableValidate'
import type { TableProjection } from '../../skins/comic-book/editor/types'

// A projected table is a nested document inside a picture, which is what makes it the one
// part of the config the surrounding merge-over-a-default cannot repair. These tests cover
// the three ways it moves: switched on fresh, read back out of a saved payload, and
// written into layoutConfig.ts.

/** Evaluate a serialized table literal, as a paste into the config file would. */
function reparseTable(ts: string): TableProjection {
  return new Function(`return (${ts})`)() as TableProjection
}

describe('newTable', () => {
  it('is visible the moment it is switched on', () => {
    const t = newTable()
    expect(t.quad).toHaveLength(4)
    expect(t.columns.length).toBeGreaterThan(0)
    expect(t.data.length).toBeGreaterThan(0)
    expect(t.rows).toBeGreaterThan(1)
  })

  it('hands out a fresh quad each time, not the shared default', () => {
    const a = newTable()
    a.quad[0][0] = 42
    expect(newTable().quad[0][0]).not.toBe(42)
  })
})

describe('coerceQuad', () => {
  it('takes four pairs and clamps them to the draggable range', () => {
    expect(coerceQuad([[0, 0], [100, 0], [100, 100], [-500, 900]])).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [-100, 200],
    ])
  })

  it('reads numbers that came back from JSON as strings', () => {
    expect(coerceQuad([['10', '20'], [90, 20], [90, 80], [10, 80]])?.[0]).toEqual([10, 20])
  })

  // Three corners is not a plane in perspective, and there is no fourth to invent — the
  // author's is the only one that would have been right.
  it('refuses anything that is not four corners', () => {
    expect(coerceQuad([[0, 0], [1, 1], [2, 2]])).toBeNull()
    expect(coerceQuad('quad')).toBeNull()
    expect(coerceQuad(null)).toBeNull()
    expect(coerceQuad([[0, 0], [1, 1], [2, 2], [3]])).toBeNull()
  })
})

describe('coerceTable', () => {
  it('says undefined for a picture that is simply not a surface', () => {
    expect(coerceTable(undefined)).toBeUndefined()
    expect(coerceTable(null)).toBeUndefined()
    expect(coerceTable(7)).toBeUndefined()
    expect(coerceTable({ rows: 8 })).toBeUndefined()
  })

  it('returns a saved table unchanged', () => {
    const t = newTable()
    expect(coerceTable(JSON.parse(JSON.stringify(t)))).toEqual(t)
  })

  /*
   * Repair, not rejection. A table is corners dragged onto a photograph plus every cell
   * the author typed; discarding all of it because one number arrived as a string would
   * be the expensive way to handle a payload written by an older build.
   */
  it('repairs the fields around a quad it can read', () => {
    const t = coerceTable({
      quad: [[0, 0], [100, 0], [100, 100], [0, 100]],
      rows: 8.6,
      fontScale: 99,
      ink: 42,
      columns: [{ label: 'a', width: 'wide', align: 'sideways' }],
      data: [['x', 'y', 'z'], 'not a row', [1, null]],
    })
    expect(t?.rows).toBe(9)
    expect(t?.fontScale).toBe(1)
    expect(t?.ink).toBe('#1b3a8f')
    expect(t?.columns).toEqual([{ label: 'a', width: 1, align: 'left' }])
    // Every row re-shaped to the column count, whatever it arrived as.
    expect(t?.data).toEqual([['x'], [''], ['1']])
  })

  it('backfills the columns when a payload has none', () => {
    const t = coerceTable({ quad: [[0, 0], [10, 0], [10, 10], [0, 10]], columns: [] })
    expect(t?.columns).toEqual(newTable().columns)
  })

  it('treats a missing header flag as headed, since that is the shipped default', () => {
    const quad = [[0, 0], [10, 0], [10, 10], [0, 10]]
    expect(coerceTable({ quad })?.header).toBe(true)
    expect(coerceTable({ quad, header: false })?.header).toBe(false)
  })
})

describe('cloneTable', () => {
  it('shares no corner, column or cell with the original', () => {
    const t = newTable()
    const copy = cloneTable(t)
    copy.quad[0][0] = 1
    copy.columns[0].label = 'changed'
    copy.data[0][0] = 'changed'
    expect(t.quad[0][0]).not.toBe(1)
    expect(t.columns[0].label).not.toBe('changed')
    expect(t.data[0][0]).not.toBe('changed')
  })
})

describe('seedConfig / cloneConfig', () => {
  // The working copy is edited in place by the inspector; a shared cell would write
  // straight back into the module the editor is supposed to be a copy of.
  it('deep-copies a table rather than aliasing the shipped one', () => {
    const cfg = seedConfig()
    cfg.images[0].table = newTable()
    const copy = cloneConfig(cfg)
    copy.images[0].table!.data[0][0] = 'changed'
    expect(cfg.images[0].table!.data[0][0]).not.toBe('changed')
  })

  it('leaves an ordinary picture with no table key at all', () => {
    expect('table' in seedConfig().images[0]).toBe(false)
  })
})

describe('hydrateConfig', () => {
  it('brings a saved surface back with its corners and cells', () => {
    const cfg = seedConfig()
    cfg.images[1].table = newTable()
    const back = hydrateConfig(JSON.stringify(cfg))
    expect(back.images[1].table).toEqual(cfg.images[1].table)
  })

  it('leaves a picture that is not a surface without a table', () => {
    const back = hydrateConfig(JSON.stringify(seedConfig()))
    expect('table' in back.images[0]).toBe(false)
  })

  // A payload written by hand, or by a build where a field meant something else. The
  // picture has to come back either way: the alternative is a page that will not render.
  it('drops a table whose quad cannot be read, keeping the picture', () => {
    const cfg = seedConfig()
    cfg.images[2].table = { ...newTable(), quad: 'broken' as never }
    const back = hydrateConfig(JSON.stringify(cfg))
    expect('table' in back.images[2]).toBe(false)
    expect(back.images[2].src).toBe(cfg.images[2].src)
  })
})

describe('serializeTable', () => {
  it('re-evaluates to the table it was written from', () => {
    const t = newTable()
    expect(reparseTable(serializeTable(t))).toEqual(t)
  })

  it('rounds drag noise out of the corners without moving them', () => {
    const t: TableProjection = { ...newTable(), quad: [[10.000000002, 9.999999998], [90.126, 10], [90, 90], [10, 90]] }
    const ts = serializeTable(t)
    expect(ts).toContain('quad: [[10, 10], [90.13, 10], [90, 90], [10, 90]]')
  })

  it('escapes a quote the author typed into a heading or a cell', () => {
    const t: TableProjection = {
      ...newTable(),
      columns: [{ label: 'a "quoted" head', width: 1, align: 'left' }],
      data: [["it's here"]],
    }
    expect(reparseTable(serializeTable(t))).toEqual(t)
  })

  it('writes one line per row, so a diff of the config reads as rows', () => {
    const ts = serializeTable(newTable())
    const dataBlock = ts.slice(ts.indexOf('data: ['), ts.lastIndexOf('],'))
    expect(dataBlock.split('\n').filter(l => l.includes('['))).toHaveLength(newTable().data.length + 1)
  })
})

describe('tableSuffix', () => {
  it('writes nothing at all for a picture that is not a surface', () => {
    expect(tableSuffix(undefined)).toBe('')
    expect(tableSuffix(null)).toBe('')
  })

  it('opens with the comma that joins it to the picture line', () => {
    expect(tableSuffix(newTable()).startsWith(', table: {')).toBe(true)
  })
})

// ─── A surface pointed at a live feed ────────────────────────────────────────
// The whole of the live wiring that reaches the config is one optional word. What the
// config must never carry is the rows themselves: they are real call records, so a save
// that wrote them would put customer phone numbers into a source file under review.

describe('coerceSource', () => {
  it('accepts the names the app actually feeds', () => {
    expect(coerceSource('calls')).toBe('calls')
    expect(coerceSource('sms')).toBe('sms')
  })

  it('reads anything else as an authored surface rather than guessing', () => {
    expect(coerceSource('voicemail')).toBeUndefined()
    expect(coerceSource('')).toBeUndefined()
    expect(coerceSource(undefined)).toBeUndefined()
    expect(coerceSource(7)).toBeUndefined()
  })
})

describe('liveTable / authoredTable', () => {
  it('takes the feed\'s headings, one per cell the mapper emits', () => {
    const t = liveTable(newTable(), 'calls')
    expect(t.source).toBe('calls')
    expect(t.columns).toEqual(LIVE_TABLE_FEEDS.calls.columns)
    expect(t.data).toEqual([])
  })

  it('keeps the corners, band count and ink the author already placed', () => {
    const base: TableProjection = { ...newTable(), rows: 12, ink: '#111111' }
    const t = liveTable(base, 'sms')
    expect(t.quad).toEqual(base.quad)
    expect(t.rows).toBe(12)
    expect(t.ink).toBe('#111111')
  })

  it('shares no column object with the feed it was built from', () => {
    const t = liveTable(newTable(), 'calls')
    t.columns[0].label = 'changed'
    expect(LIVE_TABLE_FEEDS.calls.columns[0].label).not.toBe('changed')
  })

  it('removes the key rather than setting it to undefined, so absence stays absence', () => {
    const off = authoredTable(liveTable(newTable(), 'calls'))
    expect('source' in off).toBe(false)
  })
})

describe('coerceTable with a source', () => {
  it('brings a live surface back with its feed', () => {
    const t = liveTable(newTable(), 'sms')
    expect(coerceTable(JSON.parse(JSON.stringify(t)))).toEqual(t)
  })

  it('leaves an authored surface with no source key', () => {
    expect('source' in coerceTable(JSON.parse(JSON.stringify(newTable())))!).toBe(false)
  })

  it('reads a source it does not know as an authored surface, keeping the cells', () => {
    const t = coerceTable({ ...newTable(), source: 'voicemail' })
    expect('source' in t!).toBe(false)
    expect(t?.data.length).toBeGreaterThan(0)
  })

  // Belt and braces on the privacy invariant: whatever a payload claims, a surface that
  // names a feed comes back empty, because its rows arrive from the API a moment later.
  it('throws away cells that came in beside a source', () => {
    const t = coerceTable({ ...newTable(), source: 'calls', data: [['14:30', 'In', '+14155550000']] })
    expect(t?.data).toEqual([])
  })
})

describe('serializeTable with a source', () => {
  it('re-evaluates to the live surface it was written from', () => {
    const t = liveTable(newTable(), 'calls')
    expect(reparseTable(serializeTable(t))).toEqual(t)
  })

  it('writes the feed name and an empty data block, never a record', () => {
    const ts = serializeTable(liveTable(newTable(), 'sms'))
    expect(ts).toContain("source: 'sms',")
    expect(reparseTable(ts).data).toEqual([])
  })

  it('writes no source line for an authored surface', () => {
    expect(serializeTable(newTable())).not.toContain('source:')
  })
})
