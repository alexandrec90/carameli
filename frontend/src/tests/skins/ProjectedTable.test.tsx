import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ProjectedTable from '../../skins/comic-book/ProjectedTable'
import { WHEEL_ROW_PX } from '../../skins/comic-book/tableData'
import type { Quad } from '../../skins/comic-book/tableProjection'
import type { TableProjection } from '../../skins/comic-book/editor/types'

// The rendered surface. Two things are being defended here, and they are the two halves
// of what was asked for: outside the editor a reader sees values and nothing else — no
// outline, no guides, no bar — and a wheel moves whole rows, so the lettering never lands
// between the lines drawn in the picture.

const FRAME = { w: 400, h: 300 }

function table(over: Partial<TableProjection> = {}): TableProjection {
  return {
    quad: [[10, 10], [90, 10], [90, 90], [10, 90]],
    rows: 5,
    header: true,
    columns: [
      { label: 'Name', width: 2, align: 'left' },
      { label: 'Number', width: 1, align: 'right' },
    ],
    data: Array.from({ length: 10 }, (_, i) => [`name ${i}`, `55${i}`]),
    fontScale: 0.5,
    ink: '#1b3a8f',
    ...over,
  }
}

function draw(over: Partial<TableProjection> = {}, editing = false) {
  const view = render(<ProjectedTable table={table(over)} frame={FRAME} editing={editing} />)
  const surface = view.container.querySelector('.cb-ptable-surface') as HTMLElement | null
  const names = () =>
    Array.from(view.container.querySelectorAll('tbody tr')).map(
      tr => tr.querySelector('td')?.textContent ?? '',
    )
  return { ...view, surface, names }
}

describe('ProjectedTable', () => {
  it('fills exactly the bands the author asked for, headings included', () => {
    const { container } = draw()
    expect(container.querySelectorAll('thead tr')).toHaveLength(1)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4)
    expect(screen.getByText('Name')).toBeTruthy()
  })

  it('spends no band on headings when the author turns them off', () => {
    const { container } = draw({ header: false })
    expect(container.querySelectorAll('thead')).toHaveLength(0)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5)
  })

  /*
   * There is no scroll container and nothing to draw a bar against: the rows past the
   * window are not in the document at all. That is also what makes the snap exact — a
   * clipped tall list would put row boundaries wherever the pixels fell.
   */
  it('leaves the rows past the window out of the document entirely', () => {
    const { container, names } = draw()
    expect(names()).toEqual(['name 0', 'name 1', 'name 2', 'name 3'])
    expect(container.textContent).not.toContain('name 9')
  })

  it('moves one whole row per notch of wheel', () => {
    const { surface, names } = draw()
    fireEvent.wheel(surface!, { deltaY: WHEEL_ROW_PX })
    expect(names()).toEqual(['name 1', 'name 2', 'name 3', 'name 4'])
    fireEvent.wheel(surface!, { deltaY: -WHEEL_ROW_PX })
    expect(names()).toEqual(['name 0', 'name 1', 'name 2', 'name 3'])
  })

  it('does not move on travel worth less than a row', () => {
    const { surface, names } = draw()
    fireEvent.wheel(surface!, { deltaY: WHEEL_ROW_PX / 4 })
    expect(names()).toEqual(['name 0', 'name 1', 'name 2', 'name 3'])
  })

  // The snap, stated as the thing a reader would see break: the same number of bands is
  // filled at every scroll position, so a row is drawn on the same drawn line throughout.
  it('keeps the band count fixed all the way to the end of the data', () => {
    const { surface, container } = draw()
    for (let i = 0; i < 12; i++) {
      fireEvent.wheel(surface!, { deltaY: WHEEL_ROW_PX })
      expect(container.querySelectorAll('tbody tr')).toHaveLength(4)
    }
  })

  it('stops at the last row rather than scrolling into blank bands', () => {
    const { surface, names } = draw()
    for (let i = 0; i < 20; i++) fireEvent.wheel(surface!, { deltaY: WHEEL_ROW_PX })
    expect(names()).toEqual(['name 6', 'name 7', 'name 8', 'name 9'])
  })

  it('ignores the wheel when every row already fits', () => {
    const { surface, names } = draw({ data: [['solo', '5550']] })
    fireEvent.wheel(surface!, { deltaY: WHEEL_ROW_PX * 3 })
    expect(names()[0]).toBe('solo')
  })

  it('shows nothing of the editor to a reader', () => {
    const { container, surface } = draw()
    expect(surface!.className).not.toContain('cb-ptable-editing')
    expect(container.querySelector('.cb-ed-quad')).toBeNull()
  })

  it('draws the outline and the band guides in the editor, and keeps out of the pointer', () => {
    const { surface } = draw({}, true)
    expect(surface!.className).toContain('cb-ptable-editing')
    expect(surface!.style.pointerEvents).toBe('none')
  })

  // The editor's own drag targets sit over this panel. A table that took the wheel there
  // would scroll rows while the author was trying to move the picture.
  it('does not take the wheel while the editor is open', () => {
    const { surface, names } = draw({}, true)
    fireEvent.wheel(surface!, { deltaY: WHEEL_ROW_PX })
    expect(names()).toEqual(['name 0', 'name 1', 'name 2', 'name 3'])
  })

  it('sizes the bands from the row count, not from the cell contents', () => {
    const { surface } = draw({ rows: 10 })
    const height = Number.parseFloat(surface!.style.height)
    expect(surface!.style.getPropertyValue('--cb-ptable-row')).toBe(`${height / 10}px`)
  })

  it('lands the surface on the quad with a projective transform', () => {
    const { surface } = draw()
    expect(surface!.style.transform.startsWith('matrix3d(')).toBe(true)
    expect(surface!.style.color).toBeTruthy()
  })

  // A quad the author has collapsed while dragging has no matrix; drawing nothing beats
  // letting CSS drop a NaN transform and leave an unplaced table over the picture.
  it('draws nothing at all for a surface that has no geometry', () => {
    const point: Quad = [[50, 50], [50, 50], [50, 50], [50, 50]]
    const { container } = draw({ quad: point })
    expect(container.innerHTML).toBe('')
  })

  it('gives the keyboard the same whole-row step the wheel has', () => {
    const { names } = draw()
    fireEvent.click(screen.getByRole('button', { name: 'Scroll table down' }))
    expect(names()).toEqual(['name 1', 'name 2', 'name 3', 'name 4'])
    fireEvent.click(screen.getByRole('button', { name: 'Scroll table up' }))
    expect(names()).toEqual(['name 0', 'name 1', 'name 2', 'name 3'])
  })

  it('announces where in the data the visible rows are', () => {
    draw()
    expect(screen.getByText('Rows 1–4 of 10')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Scroll table down' }))
    expect(screen.getByText('Rows 2–5 of 10')).toBeTruthy()
  })

  it('offers no scroll controls when there is nothing to scroll', () => {
    draw({ data: [['solo', '5550']] })
    expect(screen.queryByRole('button', { name: 'Scroll table down' })).toBeNull()
  })
})
