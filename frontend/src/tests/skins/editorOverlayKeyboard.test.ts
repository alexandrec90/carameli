import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PanelPoly } from '../../skins/comic-book/panelGeometry'
import type { BubbleTransform, ImgTransform } from '../../skins/comic-book/editor/types'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'
import { useOverlayKeyboard } from '../../skins/comic-book/editor/useOverlayKeyboard'

// The editor overlay's keyboard half. The pointer half shares `selectionBounds` with it,
// so the bounds cases here cover both; the pure transforms themselves are
// editorTransformsMath.test.ts.

/** A 200x100 panel box, so a 1px nudge is a round 0.5% across and 1% down. */
const PANEL: PanelPoly = {
  vp: [],
  bounds: { x: 0, y: 0, w: 200, h: 100 },
}

const IMG: ImgTransform = {
  panel: 0,
  src: '/comic-book/logo.webp',
  alt: '',
  left: 10,
  top: 10,
  width: 50,
  height: 50,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
} as ImgTransform

const BUBBLE: BubbleTransform = {
  panel: 0,
  top: 10,
  right: 10,
  width: 40,
  rotate: 0,
} as BubbleTransform

interface Spies {
  setImg: ReturnType<typeof vi.fn>
  setBubble: ReturnType<typeof vi.fn>
  deleteImg: ReturnType<typeof vi.fn>
  deleteBubble: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
}

function makeApi(selected: EditorModeApi['selected']): { api: EditorModeApi; spies: Spies } {
  const spies: Spies = {
    setImg: vi.fn(),
    setBubble: vi.fn(),
    deleteImg: vi.fn(),
    deleteBubble: vi.fn(),
    clear: vi.fn(),
  }
  const api = {
    selected,
    callPhase: null,
    config: { images: [IMG], bubbles: [BUBBLE], callScenes: [] },
    ...spies,
  } as unknown as EditorModeApi
  return { api, spies }
}

/** Mount the hook and press one key, returning the event so `defaultPrevented` is readable. */
function press(
  selected: EditorModeApi['selected'],
  key: string,
  init: KeyboardEventInit = {},
  polys: (PanelPoly | null)[] = [PANEL],
): { spies: Spies; event: KeyboardEvent } {
  const { api, spies } = makeApi(selected)
  renderHook(() => useOverlayKeyboard(api, polys))
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init })
  window.dispatchEvent(event)
  return { spies, event }
}

const IMG_SEL = { kind: 'img', index: 0 } as const
const BUBBLE_SEL = { kind: 'bubble', index: 0 } as const
const PANEL_SEL = { kind: 'panel', index: 0 } as const

afterEach(() => {
  vi.restoreAllMocks()
})

describe('picture shortcuts', () => {
  it('an arrow moves the frame by one px of the panel box', () => {
    const { spies, event } = press(IMG_SEL, 'ArrowRight')
    // 1px across a 200px-wide panel box = 0.5%.
    expect(spies.setImg).toHaveBeenCalledWith(0, expect.objectContaining({ left: 10.5, top: 10 }))
    expect(event.defaultPrevented).toBe(true)
  })

  it('Shift makes the nudge coarse', () => {
    const { spies } = press(IMG_SEL, 'ArrowDown', { shiftKey: true })
    // 10px down a 100px-tall panel box = 10%.
    expect(spies.setImg).toHaveBeenCalledWith(0, expect.objectContaining({ top: 20, left: 10 }))
  })

  it('Alt+arrow pans the picture behind its frame instead of moving the frame', () => {
    const { spies } = press(IMG_SEL, 'ArrowRight', { altKey: true })
    const next = spies.setImg.mock.calls[0][1] as ImgTransform
    // The frame stays put; the picture slides inside it.
    expect(next.left).toBe(10)
    expect(next.offsetX).toBeGreaterThan(0)
  })

  it('+ and - zoom the picture, and Alt sizes the frame instead', () => {
    expect(press(IMG_SEL, '+').spies.setImg).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ scale: 1.05 }),
    )
    expect(press(IMG_SEL, '-').spies.setImg).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ scale: 0.95 }),
    )
    expect(press(IMG_SEL, '+', { altKey: true }).spies.setImg).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ width: 51, height: 51, scale: 1 }),
    )
  })

  it('treats = as + and _ as -, so the shift state of the key does not matter', () => {
    expect(press(IMG_SEL, '=').spies.setImg).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ scale: 1.05 }),
    )
    expect(press(IMG_SEL, '_').spies.setImg).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ scale: 0.95 }),
    )
  })

  it('Delete and Backspace remove the picture; Escape deselects', () => {
    expect(press(IMG_SEL, 'Delete').spies.deleteImg).toHaveBeenCalledWith(0)
    expect(press(IMG_SEL, 'Backspace').spies.deleteImg).toHaveBeenCalledWith(0)
    expect(press(IMG_SEL, 'Escape').spies.clear).toHaveBeenCalled()
  })
})

describe('bubble shortcuts', () => {
  it('an arrow drags the bubble, and its right anchor moves opposite the arrow', () => {
    const { spies } = press(BUBBLE_SEL, 'ArrowRight')
    // Anchored by `right`, so moving right reduces it.
    expect(spies.setBubble).toHaveBeenCalledWith(0, expect.objectContaining({ right: 9.5 }))
  })

  it('+ and - resize the bubble by one width step', () => {
    expect(press(BUBBLE_SEL, '+').spies.setBubble).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ width: 41 }),
    )
    expect(press(BUBBLE_SEL, '-').spies.setBubble).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ width: 39 }),
    )
  })

  it('Delete removes the bubble; Escape deselects', () => {
    expect(press(BUBBLE_SEL, 'Delete').spies.deleteBubble).toHaveBeenCalledWith(0)
    expect(press(BUBBLE_SEL, 'Escape').spies.clear).toHaveBeenCalled()
  })
})

describe('what the shortcuts deliberately leave alone', () => {
  it('a selected panel answers only Escape — it is a slot, not a drawn thing', () => {
    const escape = press(PANEL_SEL, 'Escape')
    expect(escape.spies.clear).toHaveBeenCalled()
    expect(escape.event.defaultPrevented).toBe(true)

    const arrow = press(PANEL_SEL, 'ArrowRight')
    expect(arrow.spies.clear).not.toHaveBeenCalled()
    expect(arrow.spies.setImg).not.toHaveBeenCalled()
    expect(arrow.event.defaultPrevented).toBe(false)
  })

  it('an unhandled key is left to the page', () => {
    const { spies, event } = press(IMG_SEL, 'a')
    expect(spies.setImg).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('nothing is wired while nothing is selected', () => {
    const { spies } = press(null, 'ArrowRight')
    expect(spies.setImg).not.toHaveBeenCalled()
    expect(spies.clear).not.toHaveBeenCalled()
  })

  it('typing into a field is not a shortcut', () => {
    // The arrow key belongs to the caret in the bubble text area, not to the bubble.
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const field = document.createElement(tag)
      document.body.appendChild(field)
      const { api, spies } = makeApi(BUBBLE_SEL)
      renderHook(() => useOverlayKeyboard(api, [PANEL]))
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      expect(spies.setBubble).not.toHaveBeenCalled()
      field.remove()
    }
  })

  it('a contenteditable target is a typing target too', () => {
    const div = document.createElement('div')
    div.contentEditable = 'true'
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(div, 'isContentEditable', { value: true })
    document.body.appendChild(div)
    const { api, spies } = makeApi(BUBBLE_SEL)
    renderHook(() => useOverlayKeyboard(api, [PANEL]))
    div.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    )
    expect(spies.setBubble).not.toHaveBeenCalled()
    div.remove()
  })

  it('does nothing when the selection names a panel that has no polygon yet', () => {
    const { spies } = press(IMG_SEL, 'ArrowRight', {}, [null])
    expect(spies.setImg).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted', () => {
    const { api, spies } = makeApi(IMG_SEL)
    const { unmount } = renderHook(() => useOverlayKeyboard(api, [PANEL]))
    unmount()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }))
    expect(spies.setImg).not.toHaveBeenCalled()
  })
})
