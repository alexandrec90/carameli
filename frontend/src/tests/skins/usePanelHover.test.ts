import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { usePanelHover } from '../../skins/comic-book/usePanelHover'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'
import type { PanelPoly } from '../../skins/comic-book/panelGeometry'

const POLYS: (PanelPoly | null)[] = [
  {
    vp: [[0, 0], [100, 0], [60, 100], [0, 100]],
    bounds: { x: 0, y: 0, w: 100, h: 100 },
  },
  {
    vp: [[105, 0], [200, 0], [200, 100], [65, 100]],
    bounds: { x: 65, y: 0, w: 135, h: 100 },
  },
]

const SPILL_BUBBLE: BubbleTransform = {
  panel: 0, top: 10, right: -20, width: 40, rotate: 0, spill: true, type: 'soft',
  tail: 'none', content: 'text', text: '', linkTo: null, hoverType: null,
  clickType: null, hoverBold: false, chain: '',
}

// jsdom has no PointerEvent; the listener only reads clientX/clientY, which
// MouseEvent carries, and 'pointermove' is just the type it subscribes to.
function move(x: number, y: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))
  })
}

describe('usePanelHover', () => {
  it('follows the pointer across polygons and clears over the gutter', () => {
    const { result } = renderHook(() => usePanelHover(POLYS, [], [], {}))
    expect(result.current).toBeNull()

    move(30, 50)
    expect(result.current).toBe(0)

    // Inside panel 0's bounding rectangle but panel 1's polygon — the case the
    // per-element mouseenter got wrong.
    move(95, 90)
    expect(result.current).toBe(1)

    move(82, 50)
    expect(result.current).toBeNull()
  })

  it('keeps the hover while the pointer rides a spilled balloon over the seam', () => {
    const { result } = renderHook(() => usePanelHover(POLYS, [], [SPILL_BUBBLE], {}))

    move(30, 20)
    expect(result.current).toBe(0)

    // (110, 20) is inside panel 1's polygon, but still on panel 0's balloon.
    move(110, 20)
    expect(result.current).toBe(0)

    // Off the balloon: now it is panel 1's ground, so panel 1 lights.
    move(150, 80)
    expect(result.current).toBe(1)
  })

  it('clears the hover when the pointer leaves the document', () => {
    const { result } = renderHook(() => usePanelHover(POLYS, [], [], {}))

    move(30, 50)
    expect(result.current).toBe(0)

    act(() => {
      document.documentElement.dispatchEvent(new MouseEvent('mouseleave'))
    })
    expect(result.current).toBeNull()
  })

  it('stops listening on unmount', () => {
    const { result, unmount } = renderHook(() => usePanelHover(POLYS, [], [], {}))
    move(30, 50)
    expect(result.current).toBe(0)
    unmount()
    expect(() => move(150, 50)).not.toThrow()
  })
})
