import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import BubbleInspector from '../../skins/comic-book/editor/BubbleInspector'
import ImageInspector from '../../skins/comic-book/editor/ImageInspector'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'

function apiFor(panel: number, kind: 'image' | 'bubble'): EditorModeApi {
  const config = seedConfig()
  if (kind === 'image') config.images[0] = { ...config.images[0], panel }
  else config.bubbles[0] = { ...config.bubbles[0], panel }
  return {
    config,
    setImg: vi.fn(),
    setBubble: vi.fn(),
  } as unknown as EditorModeApi
}

function panelOptions(): string[] {
  const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'panel' })
  return [...select.options].map(option => option.text)
}

describe('comic-book panel destination controls', () => {
  it('offers an image only panels on its current page', () => {
    const api = apiFor(9, 'image')
    render(<ImageInspector api={api} index={0} image={api.config.images[0]} />)

    expect(panelOptions()).toEqual(
      api.config.panels.filter(panel => panel.page === 'home').map(panel => panel.label),
    )
  })

  it('offers a bubble only panels on its current page', () => {
    const api = apiFor(1, 'bubble')
    render(<BubbleInspector api={api} index={0} bubble={api.config.bubbles[0]} />)

    expect(panelOptions()).toEqual(
      api.config.panels.filter(panel => panel.page === 'classic').map(panel => panel.label),
    )
  })
})
