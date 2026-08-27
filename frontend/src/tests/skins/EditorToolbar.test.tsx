import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import EditorToolbar from '../../skins/comic-book/editor/EditorToolbar'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'
import type { SeamDragApi } from '../../skins/comic-book/editor/useSeamDrag'

vi.mock('../../skins/comic-book/editor/useToolbarColumns', () => ({
  useToolbarColumns: () => ({ columnCount: 3, width: 710 }),
}))

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
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

function renderToolbar() {
  const config = seedConfig()
  return render(
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
}

/** Stands in for the dev-only ship middleware. */
function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EditorToolbar', () => {
  it('applies the adaptive column layout to the real toolbar', () => {
    renderToolbar()

    const toolbar = screen.getByRole('region', { name: 'Comic-book editor' })
    expect(toolbar.style.columnCount).toBe('3')
    expect(toolbar.style.width).toBe('710px')
  })

  it('ships the serialized config and the typed summary to the ship endpoint', async () => {
    const fetchMock = stubFetch(200, { ok: true, message: 'Pushed agent/x-0826 — PR opened.' })
    renderToolbar()

    fireEvent.change(screen.getByLabelText('Ship summary'), {
      target: { value: 'Reframe panel 8' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ship' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/__comic-editor/ship')
    const sent = JSON.parse(String(init.body)) as { content: string; summary: string }
    expect(sent.summary).toBe('Reframe panel 8')
    expect(sent.content).toContain('PANEL_IMG_TRANSFORMS')
  })

  it('offers the PR the server opened as a link', async () => {
    stubFetch(200, {
      ok: true,
      message: 'Pushed agent/reframe-panel-8-0826 — PR opened.',
      branch: 'agent/reframe-panel-8-0826',
      prUrl: 'https://github.com/o/r/pull/233',
    })
    renderToolbar()

    fireEvent.click(screen.getByRole('button', { name: 'Ship' }))

    const link = await screen.findByRole('link', { name: 'Open PR' })
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/233')
    expect(screen.getByRole('status').textContent).toContain('PR opened')
  })

  it('shows the server-side reason when the ship fails, and no PR link', async () => {
    stubFetch(500, {
      ok: false,
      message: '[devkit branch policy] commit blocked on detached HEAD. The layout is still saved',
    })
    renderToolbar()

    fireEvent.click(screen.getByRole('button', { name: 'Ship' }))

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('commit blocked on detached HEAD')
    expect(status.className).toContain('cb-ed-ship-status-error')
    expect(screen.queryByRole('link', { name: 'Open PR' })).toBeNull()
  })

  it('disables Ship while one is in flight, so a slow push is not fired twice', async () => {
    let release: ((value: unknown) => void) | undefined
    const fetchMock = vi.fn().mockReturnValue(new Promise(res => { release = res }))
    vi.stubGlobal('fetch', fetchMock)
    renderToolbar()

    fireEvent.click(screen.getByRole('button', { name: 'Ship' }))

    const busy = await screen.findByRole<HTMLButtonElement>('button', { name: 'Shipping…' })
    expect(busy.disabled).toBe(true)
    fireEvent.click(busy)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    release?.({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, message: 'done' }) })
  })
})
