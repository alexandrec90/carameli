import { useMemo } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CONFIG_KEY } from '../../skins/comic-book/editor/configSeed'
import EditorOverlay from '../../skins/comic-book/editor/EditorOverlay'
import { useEditorMode } from '../../skins/comic-book/editor/useEditorMode'
import { frameRect } from '../../skins/comic-book/panelGeometry'
import { panelPolysIn } from '../../skins/comic-book/usePageFrame'

// The panel lifecycle, driven the way an author drives it: real hook, real overlay, real
// click targets — no mocked api anywhere.
//
// `EditorReachability` and `EditorControlSurface` mount the toolbar over a stub and ask
// whether each control exists and which mutator it calls. They cannot see the page side
// of a feature: that a panel can be *selected* by clicking it, that the mutator the
// button calls actually produces a panel, that the new panel then has a target of its
// own. Every one of those is a place a feature can be lost while both guards stay green,
// and each journey below walks the whole path from a click on the page to the result on
// the page. A journey is deleted only with the feature it drives.

vi.mock('../../skins/comic-book/editor/useToolbarColumns', () => ({
  useToolbarColumns: () => ({ columnCount: 3, width: 710 }),
}))

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

const FRAME = frameRect(1600, 900, 'landscape')

/** The classic page in a landscape window, wired as Layout.tsx wires it. */
function Editor() {
  const api = useEditorMode()
  const grid = api.config.grids.classic.landscape
  const panelPolys = useMemo(() => panelPolysIn(grid, FRAME), [grid])
  return (
    <EditorOverlay
      api={api}
      panelPolys={panelPolys}
      page="classic"
      natSizes={{}}
      layoutKind="landscape"
      frame={FRAME}
      pageSelect={{
        navItems: [],
        pageLabels: api.config.pageLabels,
        previewingLoading: false,
        onPreviewLoading: vi.fn(),
        onPageLabel: api.setPageLabel,
      }}
    />
  )
}

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const target = (label: string) => screen.queryByRole('button', { name: `Select ${label}` })

beforeEach(() => {
  // A fresh working copy, in edit mode, every time.
  window.localStorage.clear()
  window.localStorage.setItem('comic-book:edit', '1')
  window.localStorage.removeItem(CONFIG_KEY)
  render(
    <MemoryRouter>
      <Editor />
    </MemoryRouter>,
  )
})

describe('making a panel', () => {
  it('cuts a selected panel in two from shapes mode, and the new half is on the page', () => {
    press('Panel shapes')
    press('Select Mechanic')
    press('Split top / bottom')

    expect(target('Mechanic 2')).not.toBeNull()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'panel name' }).value).toBe('Mechanic 2')
  })

  it('cuts it from content mode too — where a panel is usually selected', () => {
    press('Select Mechanic')
    press('Split left / right')

    expect(target('Mechanic 2')).not.toBeNull()
  })
})

describe('hiding a panel on one shape and showing it again', () => {
  it('takes it off the page, keeps it in the list, and offers it back beside a selected panel', () => {
    press('Select Mechanic')
    press('Split top / bottom')
    press('Select Mechanic 2')
    press('Hide on landscape')

    expect(target('Mechanic 2')).toBeNull()

    press('Select Mechanic')
    expect(screen.getByRole('button', { name: 'Show Mechanic 2 below' })).toBeTruthy()
    press('Show Mechanic 2 beside')

    expect(target('Mechanic 2')).not.toBeNull()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'panel name' }).value).toBe('Mechanic 2')
  })
})

describe('deleting a panel', () => {
  it('takes it off the page and out of the list, so it is not offered back', () => {
    press('Select Mechanic')
    press('Split top / bottom')
    press('Select Mechanic 2')
    press('Delete panel')

    expect(target('Mechanic 2')).toBeNull()
    press('Select Mechanic')
    expect(screen.queryByRole('button', { name: 'Show Mechanic 2 below' })).toBeNull()
    expect(target('Mechanic')).not.toBeNull()
  })
})
