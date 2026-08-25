import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ProjectedNumberPad, {
  NUMBER_PAD_KEYS,
} from '../../skins/comic-book/ProjectedNumberPad'
import type { Quad } from '../../skins/comic-book/tableProjection'
import { newNumberPad } from '../../skins/comic-book/editor/numberPadValidate'

const FRAME = { w: 400, h: 300 }

function draw(editing = false, quad?: Quad) {
  const numberPad = newNumberPad()
  if (quad) numberPad.quad = quad
  const view = render(
    <ProjectedNumberPad numberPad={numberPad} frame={FRAME} editing={editing} />,
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

  it('draws nothing when the authored quad has collapsed to a point', () => {
    const point: Quad = [[50, 50], [50, 50], [50, 50], [50, 50]]
    expect(draw(false, point).container.innerHTML).toBe('')
  })
})
