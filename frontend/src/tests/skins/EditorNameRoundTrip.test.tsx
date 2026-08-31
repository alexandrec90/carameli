import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EditorToolbar from '../../skins/comic-book/editor/EditorToolbar'
import { CONFIG_KEY } from '../../skins/comic-book/editor/configOps'
import type { EditorConfig } from '../../skins/comic-book/editor/types'
import { useEditorMode } from '../../skins/comic-book/editor/useEditorMode'
import type { SeamDragApi } from '../../skins/comic-book/editor/useSeamDrag'

// The name fields wired to a REAL working copy, rather than to an api of `vi.fn()`s.
//
// `InspectorPanelNames.test.tsx` and `PageSelect.test.tsx` each render one component and
// assert that a mock was called. Both would keep passing if `useEditorMode` stopped
// exposing the mutator, if the mutator stopped reaching the config op, if `Layout.tsx`
// stopped passing `onPageLabel` down, or if the edit stopped being persisted — which is
// most of what "the feature" is. This file mounts the toolbar over the real hook and
// checks the two things an author would actually notice: the whole name arrives, and it
// is still there after the tab is closed.
//
// Typed one keystroke at a time on purpose. A name field re-rendered from a config that
// is rebuilt on every edit is one careless key away from remounting per character, which
// drops focus and leaves the author with a name one letter long; firing a single change
// with the finished string — as the older tests do — cannot see that at all.

vi.mock('../../skins/comic-book/editor/useToolbarColumns', () => ({
  useToolbarColumns: () => ({ columnCount: 3, width: 710 }),
}))

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

/** Enough of the shape-drag API for the shapes inspector to render. */
const SEAM_DRAG: SeamDragApi = {
  seams: [],
  selectedVertex: null,
  snapVertex: null,
  canDeleteSelected: false,
  onVertexDown: vi.fn(),
  onSeamDown: vi.fn(),
  onSeamDoubleClick: vi.fn(),
  onPointerMove: vi.fn(),
  onPointerUp: vi.fn(),
  deleteSelected: vi.fn(),
}

const PANEL = 9

/**
 * The editor chrome over the real hook, wired the way `Layout.tsx` wires it. The one
 * addition is a button to make a selection, because a selection is normally made by
 * clicking a panel on the page, and the page is not what is under test here.
 */
function EditorHarness() {
  const api = useEditorMode()
  const selPanel = api.selected?.kind === 'panel' ? api.selected.index : null

  return (
    <>
      <button type="button" onClick={() => api.select('panel', PANEL)}>
        select the panel
      </button>
      <EditorToolbar
        api={api}
        selPanel={selPanel}
        pageSelect={{
          navItems: [],
          pageLabels: api.config.pageLabels,
          previewingLoading: false,
          onPreviewLoading: vi.fn(),
          onPageLabel: api.setPageLabel,
        }}
        shapes={{
          page: 'classic',
          kind: 'landscape',
          grid: api.config.grids.classic.landscape,
          drag: SEAM_DRAG,
        }}
      />
    </>
  )
}

/**
 * Type `text` into the named field the way a keyboard does: one change per character,
 * carrying the whole value so far, re-finding the field between each so that a field
 * which remounts mid-word is caught rather than typed straight through.
 */
function typeInto(name: string, text: string) {
  const first = screen.getByRole('textbox', { name })
  first.focus()
  for (let i = 1; i <= text.length; i++) {
    const field = screen.getByRole<HTMLInputElement>('textbox', { name })
    expect(field, `the ${name} field remounted at keystroke ${i}`).toBe(first)
    expect(document.activeElement, `the ${name} field lost focus at keystroke ${i}`).toBe(field)
    fireEvent.change(field, { target: { value: text.slice(0, i) } })
  }
  return screen.getByRole<HTMLInputElement>('textbox', { name })
}

/** The working copy as it was actually written to storage. */
function persisted(): EditorConfig {
  const raw = window.localStorage.getItem(CONFIG_KEY)
  expect(raw, 'nothing was persisted').not.toBeNull()
  return JSON.parse(String(raw)) as EditorConfig
}

beforeEach(() => {
  window.localStorage.clear()
  // What `?edit=1` leaves behind, and what `detectActive` reads on a load without it.
  window.localStorage.setItem('comic-book:edit', '1')
})

function renderEditor() {
  return render(
    <MemoryRouter>
      <EditorHarness />
    </MemoryRouter>,
  )
}

describe('editor names round-trip through the working copy', () => {
  it('takes a whole typed panel name and persists it', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'select the panel' }))

    const field = typeInto('panel name', 'Mission Control')

    expect(field.value).toBe('Mission Control')
    expect(persisted().panels[PANEL].label).toBe('Mission Control')
  })

  it('takes a whole typed page name and persists it against the route', () => {
    renderEditor()

    const field = typeInto('page name', 'Situation Room')

    expect(field.value).toBe('Situation Room')
    expect(persisted().pageLabels['/']).toBe('Situation Room')
  })

  // The half the mocked tests cannot reach: a name is only "saved" if the next load
  // shows it. `useWorkingCopy` seeds from storage on mount, so a fresh mount is what a
  // reopened tab does.
  it('shows both names again on the next load', () => {
    const first = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'select the panel' }))
    typeInto('panel name', 'Mission Control')
    typeInto('page name', 'Situation Room')
    first.unmount()

    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'select the panel' }))

    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'page name' }).value)
      .toBe('Situation Room')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'panel name' }).value)
      .toBe('Mission Control')
  })

  // Renaming a panel must not disturb the route it is on, and renaming a page must not
  // touch the panels: both write into one config object, and a careless clone has
  // previously dropped the other's field on the way through.
  it('keeps the panel list and the page labels independent of each other', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'select the panel' }))

    const before = screen.getByRole<HTMLInputElement>('textbox', { name: 'panel name' }).value

    typeInto('page name', 'Situation Room')
    // Naming the route left the panel it is on alone.
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'panel name' }).value).toBe(before)

    typeInto('panel name', 'Mission Control')
    const after = persisted()
    expect(after.pageLabels['/']).toBe('Situation Room')
    expect(after.panels[PANEL].label).toBe('Mission Control')
    // Every other panel is untouched.
    expect(after.panels.filter(p => p.label === 'Mission Control')).toHaveLength(1)
  })

  // Shapes mode reaches the same working copy through a different component. Before this,
  // it reached nothing: the name was static text there.
  it('renames from shapes mode too, into the same working copy', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'select the panel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Panel shapes' }))
    // Switching modes drops the selection by design (a vertex index is not a panel index).
    fireEvent.click(screen.getByRole('button', { name: 'select the panel' }))

    const field = typeInto('panel name', 'Cut Half')

    expect(field.value).toBe('Cut Half')
    expect(persisted().panels[PANEL].label).toBe('Cut Half')
  })
})
