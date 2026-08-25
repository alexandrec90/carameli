import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import EditorToolbar from '../../skins/comic-book/editor/EditorToolbar'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'
import type { SeamDragApi } from '../../skins/comic-book/editor/useSeamDrag'

vi.mock('../../skins/comic-book/editor/useToolbarColumns', () => ({
  useToolbarColumns: () => ({ columnCount: 3, width: 710 }),
}))

function editorApi(): EditorModeApi {
  return {
    active: true,
    config: seedConfig(),
    selected: null,
    mode: 'content',
    setMode: vi.fn(),
    select: vi.fn(),
    clear: vi.fn(),
    resetAll: vi.fn(),
    setGridFor: vi.fn(),
    resetGridFor: vi.fn(),
    addImgOn: vi.fn(),
    addBubbleOn: vi.fn(),
    setImg: vi.fn(),
    setBubble: vi.fn(),
    setChained: vi.fn(),
    setChain: vi.fn(),
    addChainColumn: vi.fn(),
    setPattern: vi.fn(),
    deleteImg: vi.fn(),
    deleteBubble: vi.fn(),
    resetOne: vi.fn(),
  }
}

describe('EditorToolbar', () => {
  it('applies the adaptive column layout to the real toolbar', () => {
    const config = seedConfig()
    render(
      <MemoryRouter>
        <EditorToolbar
          api={editorApi()}
          selPanel={null}
          pageSelect={{ navItems: [], previewingLoading: false, onPreviewLoading: vi.fn() }}
          shapes={{
            page: 'classic',
            kind: 'landscape',
            grid: config.grids.classic.landscape,
            drag: {} as SeamDragApi,
          }}
        />
      </MemoryRouter>,
    )

    const toolbar = screen.getByRole('region', { name: 'Comic-book editor' })
    expect(toolbar.style.columnCount).toBe('3')
    expect(toolbar.style.width).toBe('710px')
  })
})
