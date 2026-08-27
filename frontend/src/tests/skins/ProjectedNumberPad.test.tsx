import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ProjectedNumberPad, {
  NUMBER_PAD_KEYS,
} from '../../skins/comic-book/ProjectedNumberPad'
import type { Quad } from '../../skins/comic-book/tableProjection'
import { newNumberPad } from '../../skins/comic-book/editor/numberPadValidate'

// The picture's rendered rect — deliberately not at the wrapper's origin, so a test
// below can pin that the pad is placed at the artwork rather than at the frame.
const BASE = { x: 12, y: 8, w: 400, h: 300 }

function draw(editing = false, quad?: Quad, onKey?: (key: string) => void) {
  const numberPad = newNumberPad()
  if (quad) numberPad.quad = quad
  const view = render(
    <ProjectedNumberPad
      numberPad={numberPad}
      base={BASE}
      editing={editing}
      onKey={onKey}
    />,
  )
  return {
    ...view,
    surface: view.container.querySelector('.cb-number-pad-surface') as HTMLElement | null,
  }
}

describe('ProjectedNumberPad', () => {
  it('renders the twelve keys in telephone order', () => {
    const { container } = draw()
    const keys = Array.from(container.querySelectorAll('.cb-number-pad-key')).map(
      key => key.textContent,
    )
    expect(keys).toEqual(NUMBER_PAD_KEYS)
    expect(screen.getByRole('img', { name: 'Projected number pad' })).toBeTruthy()
  })

  it('lays out exactly three columns and four rows', () => {
    const { surface } = draw()
    expect(surface!.style.gridTemplateColumns).toBe('repeat(3, 1fr)')
    expect(surface!.style.gridTemplateRows).toBe('repeat(4, 1fr)')
  })

  it('shows the alignment-grid class only in editor mode', () => {
    const reader = draw()
    const readerKey = reader.container.querySelector('.cb-number-pad-key') as HTMLElement
    expect(reader.surface!.className).not.toContain('cb-number-pad-editing')
    expect(reader.surface!.style.outline).toBe('')
    expect(readerKey.style.borderRight).toBe('')
    reader.unmount()

    const editor = draw(true)
    const editorKeys = editor.container.querySelectorAll('.cb-number-pad-key')
    expect(editor.surface!.className).toContain('cb-number-pad-editing')
    expect(editor.surface!.style.outline).toContain('dashed')
    expect((editorKeys[0] as HTMLElement).style.borderRight).toContain('solid')
    expect((editorKeys[0] as HTMLElement).style.borderBottom).toContain('solid')
    expect((editorKeys[2] as HTMLElement).style.borderRight).toBe('')
    expect((editorKeys[9] as HTMLElement).style.borderBottom).toBe('')
  })

  it('lands the pad on its quad with the shared projective transform', () => {
    const { surface } = draw()
    expect(surface!.style.transform.startsWith('matrix3d(')).toBe(true)
    expect(surface!.style.pointerEvents).toBe('none')
  })

  it("sits at the rendered rect's origin, so it rides the picture and not the frame", () => {
    const { surface } = draw()
    expect(surface!.style.left).toBe('12px')
    expect(surface!.style.top).toBe('8px')
  })

  it('is a picture, not a control, until a key handler is supplied', () => {
    const { container, surface } = draw()
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(surface!.style.pointerEvents).toBe('none')
    expect(screen.getByRole('img', { name: 'Projected number pad' })).toBeTruthy()
  })

  it('becomes twelve live keys when a handler is supplied', () => {
    const onKey = vi.fn()
    const { container, surface } = draw(false, undefined, onKey)

    const buttons = container.querySelectorAll('button')
    expect(buttons).toHaveLength(12)
    expect(surface!.style.pointerEvents).toBe('auto')
    expect(screen.getByRole('group', { name: 'Number pad' })).toBeTruthy()

    // Down, not click: a telephone key makes its tone on the way down.
    fireEvent.pointerDown(screen.getByRole('button', { name: '5' }))
    expect(onKey).toHaveBeenCalledWith('5')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'star' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'hash' }))
    expect(onKey).toHaveBeenNthCalledWith(2, '*')
    expect(onKey).toHaveBeenNthCalledWith(3, '#')
  })

  it('presses a key from the keyboard, once per press', () => {
    const onKey = vi.fn()
    draw(false, undefined, onKey)
    const two = screen.getByRole('button', { name: '2' })

    fireEvent.keyDown(two, { key: 'Enter' })
    fireEvent.keyDown(two, { key: ' ' })
    expect(onKey).toHaveBeenCalledTimes(2)

    // A held key must not machine-gun digits into the number.
    fireEvent.keyDown(two, { key: 'Enter', repeat: true })
    fireEvent.keyDown(two, { key: 'Tab' })
    expect(onKey).toHaveBeenCalledTimes(2)
  })

  it('stays inert in editor mode even with a handler, so the corner grips keep the pointer', () => {
    const onKey = vi.fn()
    const { container, surface } = draw(true, undefined, onKey)

    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(surface!.style.pointerEvents).toBe('none')
    expect(surface!.className).toContain('cb-number-pad-editing')
  })

  it('draws nothing when the authored quad has collapsed to a point', () => {
    const point: Quad = [[50, 50], [50, 50], [50, 50], [50, 50]]
    expect(draw(false, point).container.innerHTML).toBe('')
  })
})
