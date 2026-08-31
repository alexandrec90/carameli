import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import EditorToolbar from '../../skins/comic-book/editor/EditorToolbar'
import type { EditMode, Selection } from '../../skins/comic-book/editor/selection'
import { controlSurface, dragFor, mockApi } from './editorStates'

// The editor's control surface, written down.
//
// This file exists because features kept being added to the editor and quietly dropped a
// few PRs later — the panel-name field survived in content mode and was never given to
// shapes mode, the page-name field went in and nothing downstream of `PageSelect` was
// held to rendering it. Every other editor test mounts ONE component against an api of
// `vi.fn()`s, so each of them keeps passing while the control it covers stops being
// reachable: nothing asserted that the toolbar still *renders* the inspector, or that a
// mode still reaches a field.
//
// So the guard is a whole-toolbar inventory rather than another per-control test. Each
// case below is one state an author can actually be in, and the expectation is the
// complete list of things they can operate in it. Deleting a control fails the case that
// named it; adding one fails every case it appears in, which is the point — a new control
// is registered here in the same change, and from then on it is load-bearing.
//
// What this deliberately does NOT assert is behaviour. `EditorToolbar.test.tsx` owns what
// Ship and Save do, `EditorNameRoundTrip.test.tsx` owns that the name fields are really
// wired to the working copy. This one owns only the question those cannot answer: is it
// still on screen at all.

vi.mock('../../skins/comic-book/editor/useToolbarColumns', () => ({
  useToolbarColumns: () => ({ columnCount: 3, width: 710 }),
}))

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

function renderToolbar(mode: EditMode, selected: Selection | null, selPanel: number | null) {
  const config = seedConfig()
  render(
    <MemoryRouter>
      <EditorToolbar
        api={mockApi(config, mode, selected)}
        selPanel={selPanel}
        pageSelect={{
          navItems: [],
          pageLabels: config.pageLabels,
          previewingLoading: false,
          onPreviewLoading: vi.fn(),
          onPageLabel: vi.fn(),
        }}
        shapes={{
          page: 'classic',
          kind: 'landscape',
          grid: config.grids.classic.landscape,
          drag: dragFor(config, selected),
        }}
      />
    </MemoryRouter>,
  )
}

/** The four transport controls and the mode switch: present in every state, so factored out. */
const ALWAYS = [
  'button: .ts',
  'button: Content',
  'button: Copy config',
  'button: Panel shapes',
  'button: Reset',
  'button: Save',
  'button: Ship',
  'select: Page',
  'text: Ship summary',
  'text: page name',
]

describe('editor control surface', () => {
  it('content mode, nothing selected: the page controls and the transport', () => {
    renderToolbar('content', null, null)

    expect(controlSurface()).toEqual([...ALWAYS, 'button: + Bubble', 'button: + Image', 'button: + SMS'].sort())
  })

  // The panel's own two attributes — what it is called and what its Ben-Day background
  // does — plus the three things that can be added to it.
  it('content mode, a panel selected: the panel name, its pattern, and what can be added', () => {
    renderToolbar('content', { kind: 'panel', index: 9 }, 9)

    expect(controlSurface()).toEqual(
      [...ALWAYS, 'button: + Bubble', 'button: + Image', 'button: + SMS', 'text: panel name', 'select: pattern'].sort(),
    )
    expect(screen.getByRole('textbox', { name: 'panel name' })).toBeTruthy()
  })

  // A picture inspector is the largest surface in the editor, and the one most often
  // rearranged; the panel-name field rides along with it because the picture's panel is
  // what the author is looking at.
  it('content mode, a picture selected: framing, the asset, and the owning panel name', () => {
    const config = seedConfig()
    const index = config.images.findIndex(image => image.panel === 9)
    renderToolbar('content', { kind: 'img', index }, 9)

    const surface = controlSurface()
    expect(surface).toContain('text: panel name')
    expect(surface).toContain('button: Delete image')
    expect(surface).toContain('button: Reset')
    expect(surface).toContain('checkbox: Allow spill outside frame')
  })

  it('content mode, a bubble selected: the balloon controls and the owning panel name', () => {
    const config = seedConfig()
    const index = config.bubbles.findIndex(bubble => !bubble.chain)
    renderToolbar('content', { kind: 'bubble', index }, config.bubbles[index].panel)

    const surface = controlSurface()
    expect(surface).toContain('text: panel name')
    expect(surface).toContain('button: Delete bubble')
    expect(surface).toContain('checkbox: Allow spill outside panel')
  })

  // The case this file was written for. Shapes mode showed the panel's name as static
  // text beside the two Split buttons, so the moment straight after a split — which
  // selects the new half, here, with nothing else to do to it — had no way to name it.
  it('shapes mode, a panel selected: the two splits AND the panel name', () => {
    renderToolbar('shapes', { kind: 'panel', index: 9 }, 9)

    expect(controlSurface()).toEqual(
      [
        ...ALWAYS,
        'button: Split top / bottom',
        'button: Split left / right',
        'button: Reset landscape shapes',
        'text: panel name',
      ].sort(),
    )
  })

  it('shapes mode, nothing selected: the grid reset, and no content controls', () => {
    renderToolbar('shapes', null, null)

    const surface = controlSurface()
    expect(surface).toContain('button: Reset landscape shapes')
    // + Image / + Bubble / + SMS belong to content mode; a shapes-mode toolbar offering
    // them would be adding a picture to whatever the shape editor had selected.
    expect(surface).not.toContain('button: + Image')
    expect(surface).not.toContain('button: + SMS')
  })

  // Both name fields are reachable from both modes, which is the property that was
  // missing and the one most likely to be lost again: they are rendered by two different
  // components under a `mode ===` ternary.
  it.each<[EditMode]>([['content'], ['shapes']])(
    'offers both the page name and the panel name in %s mode',
    mode => {
      renderToolbar(mode, { kind: 'panel', index: 9 }, 9)

      expect(screen.getByRole('textbox', { name: 'page name' })).toBeTruthy()
      expect(screen.getByRole('textbox', { name: 'panel name' })).toBeTruthy()
    },
  )
})
