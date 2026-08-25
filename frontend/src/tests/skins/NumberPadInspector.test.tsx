import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ImageInspector from '../../skins/comic-book/editor/ImageInspector'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import { newNumberPad } from '../../skins/comic-book/editor/numberPadValidate'
import { newTable } from '../../skins/comic-book/editor/tableValidate'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'

function editorApi() {
  return { setImg: vi.fn() } as unknown as EditorModeApi
}

describe('number-pad image option', () => {
  it('offers every image a number-pad projection and clears a table when enabled', () => {
    const api = editorApi()
    const image = { ...seedConfig().images[0], table: newTable() }
    render(<ImageInspector api={api} index={0} image={image} />)

    fireEvent.click(screen.getByLabelText('Project a number pad on this picture'))
    expect(api.setImg).toHaveBeenCalledWith(0, {
      table: undefined,
      numberPad: expect.objectContaining({ quad: expect.any(Array) }),
    })
  })

  it('shows tilt, ink, and text controls for an enabled number pad', () => {
    const api = editorApi()
    const image = { ...seedConfig().images[0], numberPad: newNumberPad() }
    render(<ImageInspector api={api} index={0} image={image} />)

    expect(screen.getByLabelText('top-left X %')).toBeTruthy()
    expect(screen.getByLabelText('ink')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset number-pad corners' })).toBeTruthy()
    expect(screen.getByText(/three-by-four grid is an alignment guide/i)).toBeTruthy()
  })

  it('clears a number pad when the table projection is enabled', () => {
    const api = editorApi()
    const image = { ...seedConfig().images[0], numberPad: newNumberPad() }
    render(<ImageInspector api={api} index={0} image={image} />)

    fireEvent.click(screen.getByLabelText('Project a table on this picture'))
    expect(api.setImg).toHaveBeenCalledWith(0, {
      table: expect.objectContaining({ rows: expect.any(Number) }),
      numberPad: undefined,
    })
  })
})
