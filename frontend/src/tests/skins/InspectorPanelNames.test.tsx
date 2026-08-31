import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import InspectorPanel from '../../skins/comic-book/editor/InspectorPanel'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'

describe('InspectorPanel names', () => {
  it('renames the owning panel while a picture on it is selected', () => {
    const config = seedConfig()
    const index = config.images.findIndex(image => image.panel === 9)
    const setPanelLabel = vi.fn()
    const api = {
      config,
      selected: { kind: 'img', index },
      setPanelLabel,
      setImg: vi.fn(),
    } as unknown as EditorModeApi

    render(<InspectorPanel api={api} panel={9} />)

    const name = screen.getByRole('textbox', { name: 'panel name' })
    expect((name as HTMLInputElement).value).toBe('Phone')
    fireEvent.change(name, { target: { value: 'Dial Pad' } })
    expect(setPanelLabel).toHaveBeenCalledWith(9, 'Dial Pad')
  })
})
