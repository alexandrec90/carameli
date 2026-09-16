import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { frameRect, layoutKindFor, OUTER_M, PAGE_ASPECT } from '../../skins/comic-book/panelGeometry'
import {
  FRAME_HEIGHT_VAR,
  pageFrameFor,
  pageFrameStyle,
  pageSheet,
  panelPolysIn,
  usePageFrame,
} from '../../skins/comic-book/usePageFrame'

// The one place the window's size enters the skin. What is pinned: the frame follows the
// window unless the editor holds a shape, a held shape gets its own aspect letterboxed
// into whatever window it is in, and the stylesheet is handed the frame's height so
// balloon lettering can be a share of it rather than of the viewport.

const ORIGINAL = { w: window.innerWidth, h: window.innerHeight }

function setWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
}

afterEach(() => {
  setWindow(ORIGINAL.w, ORIGINAL.h)
})

describe('pageFrameFor', () => {
  it('follows the window when nothing is held', () => {
    const { kind, frame } = pageFrameFor(1600, 900, null)
    expect(kind).toBe(layoutKindFor(1600, 900))
    expect(frame).toEqual(frameRect(1600, 900))
  })

  it('draws a held shape at its own aspect inside the same window', () => {
    const { kind, frame } = pageFrameFor(1600, 900, 'portrait')
    expect(kind).toBe('portrait')
    expect(frame.w / frame.h).toBeCloseTo(PAGE_ASPECT.portrait, 10)
    expect(frame).toEqual(frameRect(1600, 900, 'portrait'))
    // Held, not merely relabelled: the portrait frame is a different rectangle from the
    // one the window would have drawn on its own.
    expect(frame).not.toEqual(frameRect(1600, 900))
  })

  it('gives a window with no size a zero frame rather than a negative one', () => {
    const { frame } = pageFrameFor(0, 0, null)
    expect(frame.w).toBe(0)
    expect(frame.h).toBe(0)
  })

})

describe('pageSheet', () => {
  /** Wider than the landscape page: letterbox left and right. */
  const WIDE = { w: 1920, h: 800 }
  /** Exactly the landscape page plus its margin: no letterbox at all. */
  const EXACT = { w: 2 * OUTER_M + 1600, h: 2 * OUTER_M + 1000 }

  it('is the frame grown by its outer margin on every side', () => {
    const f = frameRect(WIDE.w, WIDE.h)
    expect(pageSheet(f)).toEqual({
      x: f.x - OUTER_M, y: f.y - OUTER_M, w: f.w + 2 * OUTER_M, h: f.h + 2 * OUTER_M,
    })
  })

  it('fills a viewport of the page aspect exactly', () => {
    expect(pageSheet(frameRect(EXACT.w, EXACT.h))).toEqual({ x: 0, y: 0, w: EXACT.w, h: EXACT.h })
  })

  it('wraps the frame it is given, not the one the window would draw', () => {
    // The editor holding portrait in a wide window: the sheet sits round that frame,
    // so the paper shows beside it rather than beside a landscape page nobody sees.
    const held = frameRect(WIDE.w, WIDE.h, 'portrait')
    expect(pageSheet(held)).toEqual({
      x: held.x - OUTER_M, y: held.y - OUTER_M, w: held.w + 2 * OUTER_M, h: held.h + 2 * OUTER_M,
    })
    expect(pageSheet(held)).not.toEqual(pageSheet(frameRect(WIDE.w, WIDE.h)))
  })
})

describe('panelPolysIn', () => {
  const grid = { vertices: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][], panels: [[0, 1, 2, 3], []] }

  it('draws every ring with a shape and nulls the empty ones', () => {
    const polys = panelPolysIn(grid, frameRect(1600, 900))
    expect(polys).toHaveLength(2)
    expect(polys[0]?.vp).toHaveLength(4)
    expect(polys[1]).toBeNull()
  })

  it('draws nothing before the window has a size', () => {
    expect(panelPolysIn(grid, { x: 0, y: 0, w: 0, h: 0 })).toEqual([])
  })
})

describe('pageFrameStyle', () => {
  it('hands the frame height to the stylesheet in px', () => {
    const style = pageFrameStyle({ x: 8, y: 8, w: 1414.4, h: 884 }) as Record<string, string>
    expect(style[FRAME_HEIGHT_VAR]).toBe('884px')
  })
})

describe('usePageFrame', () => {
  it('reads the window on mount and again on resize', () => {
    setWindow(1600, 900)
    const { result } = renderHook(() => usePageFrame(null))
    expect(result.current.kind).toBe('landscape')
    expect(result.current.frame).toEqual(frameRect(1600, 900))

    act(() => {
      setWindow(600, 900)
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current.kind).toBe('portrait')
    expect(result.current.frame).toEqual(frameRect(600, 900))
  })

  it('keeps the frame identity while nothing about it changes', () => {
    setWindow(1600, 900)
    const { result, rerender } = renderHook(() => usePageFrame(null))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(result.current).toBe(first)
  })

  it('switches to a held shape without a resize and back again', () => {
    setWindow(1600, 900)
    const { result, rerender } = renderHook(({ held }) => usePageFrame(held), {
      initialProps: { held: null as 'portrait' | null },
    })
    rerender({ held: 'portrait' })
    expect(result.current.kind).toBe('portrait')
    expect(result.current.frame).toEqual(frameRect(1600, 900, 'portrait'))
    rerender({ held: null })
    expect(result.current.kind).toBe('landscape')
    expect(result.current.frame).toEqual(frameRect(1600, 900))
  })
})
