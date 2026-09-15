import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LAYOUT_KINDS } from '../../skins/comic-book/editor/configSeed'
import ShapeSelect, {
  FOLLOW_WINDOW_VALUE,
  resolveShapeSelection,
  SHAPE_LABELS,
  shapeSelectValue,
} from '../../skins/comic-book/editor/ShapeSelect'

// The toolbar's window-shape selector: the way an author reaches the two grids the
// window is not showing without resizing it.

describe('shape selection helpers', () => {
  it('spells "follow the window" as the sentinel and a held shape as itself', () => {
    expect(shapeSelectValue(null)).toBe(FOLLOW_WINDOW_VALUE)
    for (const kind of LAYOUT_KINDS) expect(shapeSelectValue(kind)).toBe(kind)
  })

  it('resolves every shape and falls back to the window for anything else', () => {
    for (const kind of LAYOUT_KINDS) expect(resolveShapeSelection(kind)).toBe(kind)
    expect(resolveShapeSelection(FOLLOW_WINDOW_VALUE)).toBeNull()
    expect(resolveShapeSelection('sideways')).toBeNull()
  })

  it('names every shape, so the dropdown map has nothing to fall through', () => {
    for (const kind of LAYOUT_KINDS) expect(SHAPE_LABELS[kind]).toBeTruthy()
  })
})

describe('ShapeSelect', () => {
  it('offers the window and all three shapes, and reports the pick', () => {
    const onShape = vi.fn()
    render(<ShapeSelect shape={null} onShape={onShape} />)

    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Shape' })
    expect(select.value).toBe(FOLLOW_WINDOW_VALUE)
    expect([...select.options].map(o => o.value)).toEqual([FOLLOW_WINDOW_VALUE, ...LAYOUT_KINDS])

    fireEvent.change(select, { target: { value: 'portrait' } })
    expect(onShape).toHaveBeenCalledWith('portrait')
  })

  it('shows the held shape and lets go of it', () => {
    const onShape = vi.fn()
    render(<ShapeSelect shape="square" onShape={onShape} />)

    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Shape' })
    expect(select.value).toBe('square')
    fireEvent.change(select, { target: { value: FOLLOW_WINDOW_VALUE } })
    expect(onShape).toHaveBeenCalledWith(null)
  })
})
