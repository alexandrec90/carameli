import { describe, expect, it } from 'vitest'

import {
  BAND_SIT,
  bodyRows,
  clampScroll,
  columnPercents,
  filledRows,
  fitColumns,
  FONT_SCALE,
  formatRows,
  maxScroll,
  rowBand,
  parseRows,
  scrollByRows,
  visibleRows,
  wheelDeltaPx,
  WHEEL_ROW_PX,
  wheelRows,
} from '../../skins/comic-book/tableData'
import type { TableColumn, TableProjection } from '../../skins/comic-book/editor/types'

// The contents and the scrolling of a projected table. The invariant under test
// throughout is that a row lands on the *same* band at every scroll position: the offset
// is an index into the data, never a pixel, so nothing can drift a line off the ruling
// drawn in the picture.

/*
 * The band budget: everything a cell puts inside a band has to fit inside one.
 *
 * Stated as an assertion rather than as a comment because the failure it prevents is
 * silent and cumulative. A table row height is a *minimum* in CSS — content taller than
 * the band grows the row rather than overflowing it — so lettering a few per cent over its
 * band does not look wrong in that row, it walks every row below it off the ruled line and
 * eventually off the bottom of the picture. Raising `FONT_SCALE.max` back to 1 is exactly
 * that change, which is why it fails here.
 */
describe('band budget', () => {
  it('leaves the tallest lettering room to sit above its rule', () => {
    expect(FONT_SCALE.max + BAND_SIT).toBeLessThanOrEqual(1)
  })
})

const COLUMNS: TableColumn[] = [
  { label: 'Name', width: 2, align: 'left' },
  { label: 'Number', width: 1, align: 'right' },
]

function table(over: Partial<TableProjection> = {}): TableProjection {
  return {
    quad: [[0, 0], [100, 0], [100, 100], [0, 100]],
    rows: 5,
    header: true,
    columns: COLUMNS,
    data: Array.from({ length: 10 }, (_, i) => [`name ${i}`, `55${i}`]),
    fontScale: 0.5,
    ink: '#1b3a8f',
    ...over,
  }
}

describe('bodyRows', () => {
  it('spends the first band on the headings when there are any', () => {
    expect(bodyRows({ rows: 5, header: true })).toBe(4)
    expect(bodyRows({ rows: 5, header: false })).toBe(5)
  })

  it('never goes below zero, however few bands are asked for', () => {
    expect(bodyRows({ rows: 1, header: true })).toBe(0)
    expect(bodyRows({ rows: 0, header: true })).toBe(0)
  })
})

describe('maxScroll / clampScroll', () => {
  it('is zero when every row already fits', () => {
    expect(maxScroll(table({ data: [['a', 'b']] }))).toBe(0)
    expect(clampScroll(table({ data: [['a', 'b']] }), 7)).toBe(0)
  })

  it('stops at the last row rather than scrolling past the data', () => {
    const t = table() // 10 rows into 4 bands
    expect(maxScroll(t)).toBe(6)
    expect(clampScroll(t, 99)).toBe(6)
    expect(clampScroll(t, -3)).toBe(0)
  })

  it('is an integer offset even when handed a fraction or a NaN', () => {
    expect(clampScroll(table(), 2.6)).toBe(3)
    expect(clampScroll(table(), Number.NaN)).toBe(0)
  })
})

describe('scrollByRows', () => {
  it('moves whole rows and clamps at both ends', () => {
    const t = table()
    expect(scrollByRows(t, 0, 3)).toBe(3)
    expect(scrollByRows(t, 5, 4)).toBe(6)
    expect(scrollByRows(t, 1, -4)).toBe(0)
  })
})

describe('wheelRows', () => {
  it('advances one row per notch of travel', () => {
    expect(wheelRows(WHEEL_ROW_PX, 0)).toEqual({ rows: 1, carry: 0 })
    expect(wheelRows(-WHEEL_ROW_PX, 0)).toEqual({ rows: -1, carry: 0 })
  })

  // A trackpad emits a dozen small deltas where a mouse emits one whole notch. Dropping
  // the remainder would leave the table impossible to scroll on a laptop.
  it('carries sub-row travel until it adds up to a row', () => {
    let carry = 0
    let moved = 0
    for (let i = 0; i < 10; i++) {
      const step = wheelRows(WHEEL_ROW_PX / 10, carry)
      carry = step.carry
      moved += step.rows
    }
    expect(moved).toBe(1)
  })

  it('reads a line- or page-mode wheel as px before counting rows', () => {
    expect(wheelDeltaPx(3, 0)).toBe(3)
    expect(wheelDeltaPx(3, 1)).toBe(48)
    expect(wheelDeltaPx(1, 2)).toBe(400)
  })
})

describe('visibleRows', () => {
  it('shows one band per row of the window, starting at the offset', () => {
    const t = table()
    expect(visibleRows(t, 0).map(r => r[0])).toEqual(['name 0', 'name 1', 'name 2', 'name 3'])
    expect(visibleRows(t, 2).map(r => r[0])).toEqual(['name 2', 'name 3', 'name 4', 'name 5'])
  })

  /*
   * The snap guarantee, stated as the thing that would actually break: whatever the
   * offset, the same number of bands is filled, so band k is drawn at the same place on
   * the surface every time. A renderer that returned a short list at the end of the data
   * would let the last row climb up the page as it scrolled.
   */
  it('fills the same band count at every scroll position', () => {
    const t = table()
    for (let offset = 0; offset <= maxScroll(t) + 3; offset++) {
      expect(visibleRows(t, offset)).toHaveLength(bodyRows(t))
    }
  })

  it('pads a short table with empty cells instead of leaving bands unfilled', () => {
    const t = table({ data: [['solo', '5550']] })
    const rows = visibleRows(t, 0)
    expect(rows).toHaveLength(4)
    expect(rows[1]).toEqual(['', ''])
  })

  it('gives every band exactly one cell per column', () => {
    const t = table({ data: [['a']], columns: [...COLUMNS, { label: 'Note', width: 1, align: 'left' }] })
    expect(visibleRows(t, 0)[0]).toEqual(['a', '', ''])
  })
})

describe('columnPercents', () => {
  it('turns weights into percentages that sum to 100', () => {
    expect(columnPercents(COLUMNS)).toEqual([(2 / 3) * 100, (1 / 3) * 100])
  })

  it('splits evenly when a weight is missing or nonsense', () => {
    expect(columnPercents([
      { label: 'a', width: 0, align: 'left' },
      { label: 'b', width: Number.NaN, align: 'left' },
    ])).toEqual([50, 50])
  })

  it('survives an empty column list without dividing by zero', () => {
    expect(columnPercents([])).toEqual([])
  })
})

describe('parseRows / formatRows', () => {
  it('reads a spreadsheet paste, splitting on tabs', () => {
    expect(parseRows('Ada\t555\nGrace\t556', 2)).toEqual([
      ['Ada', '555'],
      ['Grace', '556'],
    ])
  })

  it('reads hand-typed rows, splitting on pipes and trimming the spaces around them', () => {
    expect(parseRows('Ada | 555\nGrace|556', 2)).toEqual([
      ['Ada', '555'],
      ['Grace', '556'],
    ])
  })

  it('pads and trims every row to the column count, so the grid stays rectangular', () => {
    expect(parseRows('a\nb|c|d', 2)).toEqual([
      ['a', ''],
      ['b', 'c'],
    ])
  })

  it('drops blank lines and a trailing carriage return', () => {
    expect(parseRows('a|1\r\n\n  \nb|2', 2)).toEqual([
      ['a', '1'],
      ['b', '2'],
    ])
  })

  it('round-trips through the editable block', () => {
    const rows = [
      ['Ada Lovelace', '555-0101'],
      ['Grace Hopper', '555-0102'],
    ]
    expect(parseRows(formatRows(rows), 2)).toEqual(rows)
  })
})

/*
 * Which bands the pointer may light, and where each one is.
 *
 * `visibleRows` pads its window so the surface covers the same bands whatever the data
 * does, which is what keeps the ruled lines under the writing area covered. The padding
 * is blank ruled line, though, so it is the one part of the window that must not answer
 * the pointer — a notepad whose empty half lights up row by row is a notepad that has
 * announced it is a table.
 */
describe('filledRows', () => {
  it('counts the slots with a record behind them, not the slots', () => {
    expect(filledRows(table({ data: [['solo', '5550']] }), 0)).toBe(1)
    expect(bodyRows(table())).toBe(4)
  })

  it('fills the whole window while there is data enough for it', () => {
    expect(filledRows(table(), 0)).toBe(4)
    expect(filledRows(table(), 6)).toBe(4)
  })

  it('counts nothing at all for a surface with no data', () => {
    expect(filledRows(table({ data: [] }), 0)).toBe(0)
  })

  it('counts nothing when the heading has eaten the only band', () => {
    expect(filledRows(table({ rows: 1 }), 0)).toBe(0)
  })

  // An offset out of range is pulled back the same way the renderer pulls it back, so the
  // count always describes the window that is actually on screen.
  it('answers for the window a stale offset lands in, not for the offset', () => {
    expect(filledRows(table({ data: [['solo', '5550']] }), 40)).toBe(1)
    expect(filledRows(table(), Number.NaN)).toBe(4)
  })
})

describe('rowBand', () => {
  it('starts the body below the heading, which owns band 0', () => {
    expect(rowBand({ header: true }, 0)).toBe(1)
    expect(rowBand({ header: true }, 3)).toBe(4)
  })

  it('starts the body at the top when there is no heading', () => {
    expect(rowBand({ header: false }, 0)).toBe(0)
    expect(rowBand({ header: false }, 3)).toBe(3)
  })

  // The band a row is *lettered* in is the band a highlight has to cover, so the two are
  // read off the same function rather than each counting the heading for itself.
  it('lands every visible row inside the surface it was sliced for', () => {
    const t = table()
    const rows = visibleRows(t, 0)
    expect(rows.map((_, i) => rowBand(t, i))).toEqual([1, 2, 3, 4])
    expect(Math.max(...rows.map((_, i) => rowBand(t, i)))).toBeLessThan(t.rows)
  })
})

describe('fitColumns', () => {
  it('re-shapes every row when a column is added or removed', () => {
    expect(fitColumns([['a', 'b']], 3)).toEqual([['a', 'b', '']])
    expect(fitColumns([['a', 'b']], 1)).toEqual([['a']])
  })
})
