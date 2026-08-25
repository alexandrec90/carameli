import { describe, expect, it } from 'vitest'

import { cloneConfig, seedConfig } from '../../skins/comic-book/editor/configSeed'
import { hydrateConfig } from '../../skins/comic-book/editor/configHydrate'
import { serializeTable, tableSuffix } from '../../skins/comic-book/editor/serializeTable'
import { cloneTable, coerceQuad, coerceTable, newTable } from '../../skins/comic-book/editor/tableValidate'
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
