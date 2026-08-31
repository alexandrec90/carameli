import { fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { splitAt } from '../../skins/comic-book/callSceneGeometry'
import EditorOverlay from '../../skins/comic-book/editor/EditorOverlay'
import { addCallScene } from '../../skins/comic-book/editor/callSceneCreate'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import type { EditorConfig } from '../../skins/comic-book/editor/types'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'
import type { PanelPoly, Rect } from '../../skins/comic-book/panelGeometry'

vi.mock('../../skins/comic-book/editor/useToolbarColumns', () => ({
  useToolbarColumns: () => ({ columnCount: 3, width: 710 }),
}))

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

// The overlay is the *other* drawing of the page: click targets and a selection outline,
// laid over pictures it never renders. Both drawings read the layout from the same two
// facts — which roles are on screen, and where the seam falls — and this file is about
// them agreeing. A target measured against the panel while its picture is measured
// against a half is a target sitting where the picture is not, and every click and every
// drag then lands somewhere the author did not point.

const CALL_PANEL = 4
const BOUNDS: Rect = { x: 100, y: 50, w: 400, h: 200 }
const VP: PanelPoly['vp'] = [
  [100, 50],
  [500, 50],
  [500, 250],
  [100, 250],
] as unknown as PanelPoly['vp']

beforeAll(() => {
  // jsdom has no pointer capture, and a drag begins by taking it.
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.hasPointerCapture = () => false
})

/** A page whose panel 4 is a phone call, made the way `+ Call` makes one. */
function calling(): EditorConfig {
  return addCallScene(seedConfig(), CALL_PANEL).config
}

/** Only the call panel is drawn, so every target on screen is one this file is about. */
function polysFor(config: EditorConfig): (PanelPoly | null)[] {
  const out: (PanelPoly | null)[] = config.panels.map(() => null)
  out[CALL_PANEL] = { vp: VP, bounds: BOUNDS }
  return out
}

function halvesFor(config: EditorConfig) {
  const scene = config.callScenes.find(s => s.panel === CALL_PANEL)!
  return splitAt(VP, BOUNDS, scene.cut, scene.axis)
}

/**
 * The picture in one of *this* panel's roles. The page ships another call already, so a
 * search by role alone finds that one — and every assertion here would then be about a
 * panel with no polygon, which is to say about nothing.
 */
function figureIn(config: EditorConfig, role: string): number {
  return config.images.findIndex(img => img.panel === CALL_PANEL && img.call === role)
}

function editorApi(config: EditorConfig, over: Partial<EditorModeApi> = {}): EditorModeApi {
  return {
    active: true,
    config,
    stale: false,
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
    ...over,
  }
}

function draw(config: EditorConfig, over: Partial<EditorModeApi> = {}) {
  const api = editorApi(config, over)
  const { container } = render(
    <MemoryRouter>
      <EditorOverlay
        api={api}
        panelPolys={polysFor(config)}
        page="classic"
        natSizes={{}}
        layoutKind="landscape"
        viewport={{ w: 1200, h: 800 }}
        pageSelect={{
          navItems: [],
          pageLabels: config.pageLabels,
          previewingLoading: false,
          onPreviewLoading: vi.fn(),
          onPageLabel: vi.fn(),
        }}
      />
    </MemoryRouter>,
  )

  /** The box a target or an outline was placed at, read back off its inline style. */
  const boxOf = (el: Element | null): Rect | null => {
    const style = (el as HTMLElement | null)?.style
    if (!style) return null
    return {
      x: parseFloat(style.left),
      y: parseFloat(style.top),
      w: parseFloat(style.width),
      h: parseFloat(style.height),
    }
  }

  return {
    api,
    container,
    imgTargets: () => Array.from(container.querySelectorAll('.cb-ed-target-img')).map(boxOf),
    bubbleTargets: () =>
      Array.from(container.querySelectorAll('.cb-ed-target-bubble')).map(boxOf),
    outline: () => container.querySelector<HTMLElement>('.cb-ed-outline'),
    boxOf,
  }
}

describe('what the overlay offers a click', () => {
  it('offers the panel’s own contents, and no call target, while the page is quiet', () => {
    const config = calling()
    const { imgTargets } = draw(config)

    // The panel's own picture, and only it: the six call entries are on a layout nobody
    // is looking at, so a target for one would select something not on screen.
    const own = config.images.filter(
      img => img.panel === CALL_PANEL && img.call === undefined,
    )
    expect(imgTargets()).toHaveLength(own.length)
  })

  it('puts each side’s target on its own half once the call is up', () => {
    const config = calling()
    const halves = halvesFor(config)
    const { imgTargets } = draw(config, { callPhase: 'ringing' })

    // Two pictures, because the far end has two faces and only one of them rings.
    const boxes = imgTargets()
    expect(boxes).toHaveLength(2)
    expect(boxes).toContainEqual(halves.a.box)
    expect(boxes).toContainEqual(halves.b.box)
    // And neither is the panel: a whole-panel target would swallow the other half's.
    expect(boxes).not.toContainEqual(BOUNDS)
  })

  it('swaps the far end’s target at the pickup', () => {
    const config = calling()
    const halves = halvesFor(config)
    const remote = figureIn(config, 'remote')
    const { imgTargets, api } = draw(config, { callPhase: 'connected' })

    expect(imgTargets()).toHaveLength(2)
    // The picture behind the far half is now the answered face, not the ringing one.
    expect(api.config.images[remote].call).toBe('remote')
    expect(imgTargets()).toContainEqual(halves.a.box)
  })

  it('measures a call balloon against its half too', () => {
    const config = calling()
    const halves = halvesFor(config)
    const { bubbleTargets } = draw(config, { callPhase: 'connected' })

    // A balloon is placed by a `right` offset and a width in % of its box, so a balloon
    // measured against the panel lands about a half-panel away from the words it labels.
    const boxes = bubbleTargets().filter((b): b is Rect => b !== null)
    expect(boxes.length).toBeGreaterThan(0)
    const spans = (box: Rect, half: Rect) =>
      box.x >= half.x - 1 && box.x + box.w <= half.x + half.w + 1
    expect(boxes.some(box => spans(box, halves.a.box))).toBe(true)
    expect(boxes.some(box => spans(box, halves.b.box))).toBe(true)
  })
})

describe('the selection outline', () => {
  it('outlines a selected call picture on its half', () => {
    const config = calling()
    const halves = halvesFor(config)
    const index = figureIn(config, 'local')
    const { outline, boxOf } = draw(config, {
      callPhase: 'ringing',
      selected: { kind: 'img', index },
    })

    expect(boxOf(outline())).toEqual(halves.b.box)
  })

  it('gives no outline to an entry the layout on screen is hiding', () => {
    const config = calling()
    const index = figureIn(config, 'remote')
    // The answered face, while the telephone is still ringing: framed, but not drawn.
    // Handles over it would drag a picture the author cannot see moving.
    const { outline } = draw(config, { callPhase: 'ringing', selected: { kind: 'img', index } })

    expect(outline()).toBeNull()
  })

  it('gives no outline to the panel’s own picture while the call is up', () => {
    const config = calling()
    const index = config.images.findIndex(
      img => img.panel === CALL_PANEL && img.call === undefined,
    )
    const { outline } = draw(config, { callPhase: 'ringing', selected: { kind: 'img', index } })

    expect(outline()).toBeNull()
  })
})

describe('a drag on a call picture', () => {
  it('is scaled by the half it is framed in, not by the whole panel', () => {
    const config = calling()
    const halves = halvesFor(config)
    const index = figureIn(config, 'local')
    const setImg = vi.fn()
    const { outline } = draw(config, {
      callPhase: 'ringing',
      selected: { kind: 'img', index },
      setImg,
    })

    const body = outline() as HTMLElement
    fireEvent.pointerDown(body, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(body, { pointerId: 1, clientX: 40, clientY: 20 })

    const start = config.images[index]
    expect(setImg).toHaveBeenCalledWith(index, {
      ...start,
      left: start.left + (40 / halves.b.box.w) * 100,
      top: start.top + (20 / halves.b.box.h) * 100,
    })
    // The panel is the wider box, so scaling by it would move the picture roughly half as
    // far as the pointer went — the drag that looks like it is fighting you.
    expect(setImg).not.toHaveBeenCalledWith(index, {
      ...start,
      left: start.left + (40 / BOUNDS.w) * 100,
      top: start.top + (20 / BOUNDS.h) * 100,
    })
  })
})
