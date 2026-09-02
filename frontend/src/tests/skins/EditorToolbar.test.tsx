import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import EditorToolbar from '../../skins/comic-book/editor/EditorToolbar'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import type { EditorConfig } from '../../skins/comic-book/editor/types'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'
import type { SeamDragApi } from '../../skins/comic-book/editor/useSeamDrag'

vi.mock('../../skins/comic-book/editor/useToolbarColumns', () => ({
  useToolbarColumns: () => ({ columnCount: 3, width: 710 }),
}))

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

function editorApi(config: EditorConfig, stale = false): EditorModeApi {
  return {
    active: true,
    config,
    stale,
    drift: null,
    untracked: false,
    adoptFromFile: vi.fn(),
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
    addSmsOn: vi.fn(),
    addPeerPickerOn: vi.fn(),
    setImg: vi.fn(),
    setBubble: vi.fn(),
    setChained: vi.fn(),
    setChain: vi.fn(),
    addChainColumn: vi.fn(),
    setPattern: vi.fn(),
    splitPanel: vi.fn(),
    callPhase: null,
    setCallPhase: vi.fn(),
    addCallOn: vi.fn(),
    setCallScene: vi.fn(),
    setPanelLabel: vi.fn(),
    setPageLabel: vi.fn(),
    deleteImg: vi.fn(),
    deleteBubble: vi.fn(),
    resetOne: vi.fn(),
  }
}

function renderToolbar(
  config: EditorConfig = seedConfig(),
  selPanel: number | null = null,
  stale = false,
) {
  const api = editorApi(config, stale)
  const view = render(
    <MemoryRouter>
      <EditorToolbar
        api={api}
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
          drag: {} as SeamDragApi,
        }}
      />
    </MemoryRouter>,
  )
  return { ...view, api }
}

/**
 * The balloon `+ Bubble` leaves behind: on a panel, but with no tail and neither morph
 * target chosen. Copied from a real stranded export rather than invented — the same
 * fixture configParity.test.ts uses — so the gate is held against what actually strands
 * a tree, not against a tidy imagining of it.
 */
function withUnfinishedBubble(): EditorConfig {
  const config = seedConfig()
  return {
    ...config,
    bubbles: [
      ...config.bubbles,
      {
        panel: 11,
        top: -20,
        right: 28,
        width: 27,
        rotate: -5,
        spill: true,
        type: 'soft',
        tail: 'none',
        content: 'text',
        text: 'New bubble',
        linkTo: null,
        hoverType: null,
        clickType: null,
        hoverBold: false,
        chain: '',
      },
    ],
  }
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
  vi.restoreAllMocks()
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
    expect(status.className).toContain('cb-ed-status-error')
    expect(screen.queryByRole('link', { name: 'Open PR' })).toBeNull()
  })

  it('says so when Save cannot write the file, rather than falling silently back to a download', async () => {
    stubFetch(400, {})
    // The fallback clicks a real `<a download>`, which happy-dom answers by navigating.
    // The announcement beside it is what this test is about.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderToolbar()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Save failed')
    expect(status.textContent).toContain('HTTP 400')
    expect(status.className).toContain('cb-ed-status-error')
    // And the button must not claim success alongside the failure.
    expect(screen.queryByRole('button', { name: 'Saved!' })).toBeNull()
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

  it('names what is unfinished and holds Ship until it is finished', () => {
    renderToolbar(withUnfinishedBubble())

    const warnings = screen.getByRole('status', { name: 'Unfinished layout' })
    expect(warnings.textContent).toContain('no tail')
    expect(warnings.textContent).toContain('no hover shape')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Ship' }).disabled).toBe(true)
  })

  it('still saves while a balloon is unfinished — mid-design is when Save matters most', async () => {
    const fetchMock = stubFetch(200, {})
    renderToolbar(withUnfinishedBubble())

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/__comic-editor/save')
  })

  // A conversation is its own button because it is not "a bubble, twice": the two halves
  // have to be linked, chained, given the right content and bound together or not at all.
  // That it sits beside `+ Image` and `+ Bubble` is the whole of the author's discovery of
  // it, so the button's presence is worth an assertion of its own.
  it('offers + SMS beside + Image and + Bubble, on the selected panel', () => {
    const { api } = renderToolbar(seedConfig(), 11)

    fireEvent.click(screen.getByRole('button', { name: '+ SMS' }))

    expect(api.addSmsOn).toHaveBeenCalledWith(11)
  })

  it('holds + SMS until a panel is picked, since a conversation belongs to one panel', () => {
    renderToolbar()

    expect(screen.getByRole<HTMLButtonElement>('button', { name: '+ SMS' }).disabled).toBe(true)
  })

  // A phone call is `+ SMS`'s argument one size up — six coupled entries and a seam — so
  // it gets a button beside the others for the same reason, and the same assertion.
  it('offers + Call on the selected panel', () => {
    const { api } = renderToolbar(seedConfig(), 4)

    fireEvent.click(screen.getByRole('button', { name: '+ Call' }))

    expect(api.addCallOn).toHaveBeenCalledWith(4)
  })

  it('holds + Call until a panel is picked, since a call belongs to one panel', () => {
    renderToolbar()

    expect(screen.getByRole<HTMLButtonElement>('button', { name: '+ Call' }).disabled).toBe(true)
  })

  it('goes dead on a panel that is already a phone call, and says why', () => {
    // A panel is cut in two once. The second set of figures would stack invisibly on the
    // first, so the button that would make them is closed rather than quietly refusing.
    const config = seedConfig()
    const panel = config.callScenes[0].panel
    renderToolbar(config, panel)

    const button = screen.getByRole<HTMLButtonElement>('button', { name: '+ Call' })
    expect(button.disabled).toBe(true)
    expect(button.title).toContain('already a phone call')
  })

  it('offers the three layouts a call panel can be framed in', () => {
    // Three positions rather than a checkbox and a phase: what a scene draws differs
    // between ringing and connected — one figure or two, and whose words are lit — so an
    // author framing it has to be able to stand in either, and in the panel's own layout.
    const { api } = renderToolbar()

    const group = screen.getByRole('group', { name: 'Call layout' })
    expect(Array.from(group.querySelectorAll('button')).map(b => b.textContent))
      .toEqual(['Default', 'Ringing', 'Connected'])

    fireEvent.click(screen.getByRole('button', { name: 'Connected' }))
    expect(api.setCallPhase).toHaveBeenCalledWith('connected')

    fireEvent.click(screen.getByRole('button', { name: 'Default' }))
    expect(api.setCallPhase).toHaveBeenCalledWith(null)
  })

  it('marks which layout is up, so the switch reads as a position and not an action', () => {
    const api = editorApi(seedConfig())
    render(
      <MemoryRouter>
        <EditorToolbar
          api={{ ...api, callPhase: 'ringing' }}
          selPanel={null}
          pageSelect={{
            navItems: [],
            pageLabels: api.config.pageLabels,
            previewingLoading: false,
            onPreviewLoading: vi.fn(),
            onPageLabel: vi.fn(),
          }}
          shapes={{
            page: 'classic',
            kind: 'landscape',
            grid: api.config.grids.classic.landscape,
            drag: {} as SeamDragApi,
          }}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Ringing' }).getAttribute('aria-pressed'))
      .toBe('true')
    expect(screen.getByRole('button', { name: 'Default' }).getAttribute('aria-pressed'))
      .toBe('false')
  })

  it('offers no layout switch on a page where nothing is a call', () => {
    const config = seedConfig()
    renderToolbar({ ...config, callScenes: [] })

    expect(screen.queryByRole('group', { name: 'Call layout' })).toBeNull()
  })

  it('says nothing and leaves Ship alone on the shipped layout', () => {
    renderToolbar()

    expect(screen.queryByRole('status', { name: 'Unfinished layout' })).toBeNull()
    expect(screen.queryByRole('status', { name: 'Working copy is behind the file' })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Ship' }).disabled).toBe(false)
  })

  // The regression these three exist for: a Save from a tab whose working copy came from
  // an older `layoutConfig.ts` wrote it back whole, reverting a merged change to the
  // call-record table. Nothing on screen had said the file had moved, and one press was
  // all it took.
  it('says so when the file has moved under the working copy', () => {
    renderToolbar(seedConfig(), null, true)

    const warning = screen.getByRole('status', { name: 'Working copy is behind the file' })
    expect(warning.textContent).toContain('layoutConfig.ts has changed')
    expect(warning.textContent).toContain('reverting whatever that was')
  })

  it('asks before overwriting a file the working copy never saw, then writes on the second press', async () => {
    const fetchMock = stubFetch(200, {})
    renderToolbar(seedConfig(), null, true)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Overwrite it?' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/__comic-editor/save')
  })

  // The confirm is for the case where the file has moved and nothing else: an ordinary
  // Save is the inner loop, pressed every few drags, and a second click on all of them
  // would be clicked through without being read.
  it('saves on the first press when the working copy is current', async () => {
    const fetchMock = stubFetch(200, {})
    renderToolbar()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })
})
