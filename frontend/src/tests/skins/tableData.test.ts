import { describe, expect, it } from 'vitest'

import {
  bodyRows,
  clampScroll,
  columnPercents,
  fitColumns,
  formatRows,
  maxScroll,
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

describe('fitColumns', () => {
  it('re-shapes every row when a column is added or removed', () => {
    expect(fitColumns([['a', 'b']], 3)).toEqual([['a', 'b', '']])
    expect(fitColumns([['a', 'b']], 1)).toEqual([['a']])
  })
})
