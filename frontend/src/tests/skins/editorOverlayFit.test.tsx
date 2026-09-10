/**
 * The editor draws the page's balloons at the page's fit (pageFit.ts), or its targets sit
 * wide of the balloons they select. On a two-monitor window the page holds a balloon to
 * half its authored width; a target measured from the authored width then covers twice
 * the balloon, the selection outline traces a box the balloon does not fill, and a resize
 * handle moves the balloon by twice the pointer's travel. These pin all three to the fit.
 */

import { fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import EditorOverlay from '../../skins/comic-book/editor/EditorOverlay'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import { bubbleRect } from '../../skins/comic-book/editor/transforms'
import type { EditorConfig } from '../../skins/comic-book/editor/types'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'
import { fitBubble, pageFit } from '../../skins/comic-book/pageFit'
import type { PanelPoly, Rect } from '../../skins/comic-book/panelGeometry'

vi.mock('../../skins/comic-book/editor/useToolbarColumns', () => ({
  useToolbarColumns: () => ({ columnCount: 3, width: 710 }),
}))

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

/** Two monitors side by side: the height of a 1920 window and twice its width. */
const WIDE = { w: 3840, h: 1000 }
const BOUNDS: Rect = { x: 100, y: 50, w: 2000, h: 400 }
const VP = [
  [100, 50],
  [2100, 50],
  [2100, 450],
  [100, 450],
] as unknown as PanelPoly['vp']

beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.hasPointerCapture = () => false
})

/** The first ordinary balloon on the page — the seed is fixed, so its index is too. */
const INDEX = seedConfig().bubbles.findIndex(b => b.call === undefined)

/** The panel that balloon sits on, drawn as the only polygon. */
function polysFor(config: EditorConfig): (PanelPoly | null)[] {
  const polys: (PanelPoly | null)[] = config.panels.map(() => null)
  polys[config.bubbles[INDEX].panel] = { vp: VP, bounds: BOUNDS }
  return polys
}

function editorApi(config: EditorConfig, over: Partial<EditorModeApi> = {}): EditorModeApi {
  return {
    active: true,
    config,
    stale: false,
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
    ...over,
  }
}

function draw(over: Partial<EditorModeApi> = {}) {
  const config = seedConfig()
  const index = INDEX
  const api = editorApi(config, over)
  const { container } = render(
    <MemoryRouter>
      <EditorOverlay
        api={api}
        panelPolys={polysFor(config)}
        page="classic"
        natSizes={{}}
        layoutKind="landscape"
        viewport={WIDE}
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
  const widthOf = (el: Element | null) => parseFloat((el as HTMLElement).style.width)
  return { api, config, index, container, widthOf }
}

describe('the editor at the page fit', () => {
  const fit = pageFit(WIDE.w, WIDE.h)

  it('is a window this file is about', () => {
    expect(fit).toBeLessThan(1)
  })

  it('places a balloon target on the balloon as drawn', () => {
    const { config, index, container, widthOf } = draw()
    const target = container.querySelector('.cb-ed-target-bubble')
    const drawn = bubbleRect(BOUNDS, fitBubble(config.bubbles[index], fit))
    expect(widthOf(target)).toBeCloseTo(drawn.w, 6)
    expect(widthOf(target)).toBeLessThan(bubbleRect(BOUNDS, config.bubbles[index]).w)
  })

  it('traces the selection outline round the balloon as drawn', () => {
    const { config, index, container, widthOf } = draw({
      selected: { kind: 'bubble', index: INDEX },
    })
    const outline = container.querySelector('.cb-ed-outline')
    const drawn = bubbleRect(BOUNDS, fitBubble(config.bubbles[index], fit))
    expect(widthOf(outline)).toBeCloseTo(drawn.w, 6)
  })

  it('resizes by the pointer’s travel over the fitted panel width', () => {
    const { api, config, index, container } = draw({ selected: { kind: 'bubble', index: INDEX } })
    const grip = container.querySelector('.cb-ed-handle-br') as HTMLElement
    expect(grip).not.toBeNull()
    const start = config.bubbles[index].width
    fireEvent.pointerDown(grip, { pointerId: 1, clientX: 500, clientY: 200 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 600, clientY: 200 })
    const set = vi.mocked(api.setBubble)
    expect(set).toHaveBeenCalled()
    const next = set.mock.calls[set.mock.calls.length - 1][1]
    // 100px of pointer over a 2000px panel drawn at `fit` is 100 / (2000 × fit) of the
    // authored width — twice the 5% it would be at a fit of 1.
    expect(next.width).toBeDefined()
    expect((next.width ?? 0) - start).toBeCloseTo((100 / (BOUNDS.w * fit)) * 100, 6)
  })
})
