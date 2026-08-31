import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CALL_ROLE_LABELS, CALL_ROLES } from '../../skins/comic-book/callSceneRoles'
import InspectorPanel from '../../skins/comic-book/editor/InspectorPanel'
import { addCallScene } from '../../skins/comic-book/editor/callSceneCreate'
import { CALL_CUT } from '../../skins/comic-book/editor/callSceneOps'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import type { EditorConfig } from '../../skins/comic-book/editor/types'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'

// The two halves of editing a call from the inspector: the seam, which belongs to the
// panel, and the role, which belongs to one entry. They are deliberately in different
// places — moving the seam from a picture's inspector would be editing every other
// entry's frame from inside one of them.

const CALL_PANEL = 4

/** A page whose panel 4 is a phone call, made the way `+ Call` makes one. */
function calling(): EditorConfig {
  return addCallScene(seedConfig(), CALL_PANEL).config
}

function apiFor(config: EditorConfig, over: Partial<EditorModeApi> = {}): EditorModeApi {
  return {
    config,
    selected: { kind: 'panel', index: CALL_PANEL },
    callPhase: null,
    setPanelLabel: vi.fn(),
    setPattern: vi.fn(),
    setCallScene: vi.fn(),
    setCallPhase: vi.fn(),
    setImg: vi.fn(),
    setBubble: vi.fn(),
    ...over,
  } as unknown as EditorModeApi
}

describe('the seam, on a selected panel', () => {
  it('offers it only on a panel that is a phone call', () => {
    const plain = apiFor(seedConfig())
    const { unmount } = render(<InspectorPanel api={plain} panel={CALL_PANEL} />)
    expect(screen.queryByRole('slider', { name: 'call seam' })).toBeNull()
    unmount()

    render(<InspectorPanel api={apiFor(calling())} panel={CALL_PANEL} />)
    expect(screen.getByRole('slider', { name: 'call seam' })).toBeTruthy()
  })

  it('drags the seam across the panel, held inside the range', () => {
    const setCallScene = vi.fn()
    render(<InspectorPanel api={apiFor(calling(), { setCallScene })} panel={CALL_PANEL} />)

    const seam = screen.getByRole<HTMLInputElement>('slider', { name: 'call seam' })
    // A cut at 0 leaves a half with no area, and nothing to drag it back by — so the
    // control never offers one, rather than relying on the clamp behind it.
    expect(seam.min).toBe(String(CALL_CUT.min))
    expect(seam.max).toBe(String(CALL_CUT.max))
    expect(seam.value).toBe('50')

    fireEvent.change(seam, { target: { value: '30' } })
    expect(setCallScene).toHaveBeenCalledWith(CALL_PANEL, { cut: 30 })
  })

  it('turns the split from side by side to stacked', () => {
    const setCallScene = vi.fn()
    render(<InspectorPanel api={apiFor(calling(), { setCallScene })} panel={CALL_PANEL} />)

    const split = screen.getByRole<HTMLSelectElement>('combobox', { name: 'call split' })
    expect(split.value).toBe('x')
    fireEvent.change(split, { target: { value: 'y' } })
    expect(setCallScene).toHaveBeenCalledWith(CALL_PANEL, { axis: 'y' })
  })
})

describe('the role, on a selected entry', () => {
  /**
   * The api with *this* panel's ringing figure selected. By role alone the search finds
   * the call the page already ships on another panel, and the assertions would then be
   * about an entry this inspector is not showing.
   */
  function withFigure(over: Partial<EditorModeApi> = {}) {
    const config = calling()
    const index = config.images.findIndex(
      img => img.panel === CALL_PANEL && img.call === 'ringing',
    )
    return { api: apiFor(config, { selected: { kind: 'img', index }, ...over }), index }
  }

  it('offers every role, plus the panel’s ordinary layout', () => {
    const { api } = withFigure()
    render(<InspectorPanel api={api} panel={CALL_PANEL} />)

    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'call role' })
    expect([...select.options].map(o => o.text))
      .toEqual(['Not part of a call', ...CALL_ROLES.map(r => CALL_ROLE_LABELS[r])])
    expect(select.value).toBe('ringing')
  })

  it('moves a picture into another half by giving it another role', () => {
    const setImg = vi.fn()
    const { api, index } = withFigure({ setImg })
    render(<InspectorPanel api={api} panel={CALL_PANEL} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'call role' }), {
      target: { value: 'local' },
    })
    expect(setImg).toHaveBeenCalledWith(index, { call: 'local' })
  })

  it('switches the page to the layout the entry has just joined', () => {
    // An entry with a role is invisible on the default layout, so a role chosen while the
    // page is on Default would appear to do nothing at all.
    const setCallPhase = vi.fn()
    const { api } = withFigure({ setCallPhase })
    render(<InspectorPanel api={api} panel={CALL_PANEL} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'call role' }), {
      target: { value: 'remote' },
    })
    // The far end answered is only on screen after the pickup, so that is the layout to
    // stand in; a ringing role would have taken the page to Ringing instead.
    expect(setCallPhase).toHaveBeenCalledWith('connected')
  })

  it('leaves a layout the author already chose alone', () => {
    const setCallPhase = vi.fn()
    const { api } = withFigure({ setCallPhase, callPhase: 'ringing' })
    render(<InspectorPanel api={api} panel={CALL_PANEL} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'call role' }), {
      target: { value: 'local' },
    })
    // The caller is on screen in both phases, and yanking the page out of Ringing would
    // move the very figures the author was framing.
    expect(setCallPhase).not.toHaveBeenCalled()
  })

  it('takes an entry out of the call, and the page back to the panel’s own contents', () => {
    const setImg = vi.fn()
    const setCallPhase = vi.fn()
    const { api, index } = withFigure({ setImg, setCallPhase, callPhase: 'ringing' })
    render(<InspectorPanel api={api} panel={CALL_PANEL} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'call role' }), {
      target: { value: '' },
    })
    // Absence, never null: which layout an entry is drawn in is decided by whether the
    // key is there at all.
    expect(setImg).toHaveBeenCalledWith(index, { call: undefined })
    expect(setCallPhase).toHaveBeenCalledWith(null)
  })

  it('gives a balloon the same control as a picture', () => {
    const setBubble = vi.fn()
    const config = calling()
    const index = config.bubbles.findIndex(
      b => b.panel === CALL_PANEL && b.call === 'local',
    )
    const api = apiFor(config, { selected: { kind: 'bubble', index }, setBubble })
    render(<InspectorPanel api={api} panel={CALL_PANEL} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'call role' }), {
      target: { value: 'remote' },
    })
    expect(setBubble).toHaveBeenCalledWith(index, { call: 'remote' })
  })
})
