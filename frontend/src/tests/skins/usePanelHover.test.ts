import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

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
  clickType: null, chain: '',
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

  describe('a chain balloon, measured off the DOM', () => {
    // A chain's balloons are stamped rows the transforms know nothing about, so the
    // hook asks the rendered elements. This builds what the renderer would have built:
    // panel 0's element holding one visible balloon whose box hangs over the seam.
    afterEach(() => {
      document.body.innerHTML = ''
    })

    function drawBalloon(over: { visible?: boolean; clipped?: boolean } = {}): void {
      const panel = document.createElement('div')
      panel.className = 'cb-panel'
      panel.dataset.cbPanel = '0'
      const balloon = document.createElement('div')
      balloon.className = `cb-panel-bubble${over.visible === false ? '' : ' is-visible'}`
      // jsdom lays nothing out, so the measurement the hook makes is stubbed: the
      // balloon's box runs x 80..120, y 10..40 — across the seam into panel 1.
      balloon.getBoundingClientRect = () =>
        ({ left: 80, right: 120, top: 10, bottom: 40 }) as DOMRect
      if (over.clipped) {
        const clip = document.createElement('div')
        clip.className = 'cb-bubble-clip'
        clip.appendChild(balloon)
        panel.appendChild(clip)
      } else {
        panel.appendChild(balloon)
      }
      document.body.appendChild(panel)
    }

    it('keeps the hover while the pointer rides a drawn balloon over the seam', () => {
      drawBalloon()
      const { result } = renderHook(() => usePanelHover(POLYS, [], [], {}))

      move(30, 20)
      expect(result.current).toBe(0)

      // (110, 20) is inside panel 1's polygon, but on the balloon panel 0 drew.
      move(110, 20)
      expect(result.current).toBe(0)

      // Off the balloon: panel 1 takes the hover, and the balloons follow it away.
      move(150, 80)
      expect(result.current).toBe(1)
    })

    it('does not stick to a balloon that is not shown', () => {
      drawBalloon({ visible: false })
      const { result } = renderHook(() => usePanelHover(POLYS, [], [], {}))

      move(30, 20)
      move(110, 20)
      expect(result.current).toBe(1)
    })

    it('does not stick to a clipped balloon — its ink stops at the panel edge', () => {
      drawBalloon({ clipped: true })
      const { result } = renderHook(() => usePanelHover(POLYS, [], [], {}))

      move(30, 20)
      move(110, 20)
      expect(result.current).toBe(1)
    })
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
