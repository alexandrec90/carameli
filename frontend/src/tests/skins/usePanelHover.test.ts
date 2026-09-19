import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { usePanelHover } from '../../skins/comic-book/usePanelHover'
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

// jsdom has no PointerEvent; the listener only reads clientX/clientY, which
// MouseEvent carries, and 'pointermove' is just the type it subscribes to.
function move(x: number, y: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))
  })
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** An axis-aligned box in viewport coordinates. */
interface Box { x0: number; x1: number; y0: number; y1: number }

/**
 * jsdom has no SVG geometry implementation, so a shape's `isPointInFill` is modelled:
 * the point is inside when it lies in `box`. `isPointInStroke` is modelled the same
 * way off `stroke`, and answers false for a shape given none — a shape with no stroke
 * has no stroke to be in. The identity screen matrix keeps the probe's
 * viewport→user-space transform a no-op.
 */
function geometry(svg: SVGSVGElement, shape: SVGElement, box: Box, stroke?: Box): void {
  // jsdom's own createSVGPoint returns a point with no matrixTransform, so the
  // element gets an own one — once, since a defined property is not configurable.
  if (!Object.prototype.hasOwnProperty.call(svg, 'createSVGPoint')) {
    Object.defineProperties(svg, {
      createSVGPoint: { value: () => ({
        x: 0,
        y: 0,
        matrixTransform() { return this },
      }) },
    })
  }
  Object.defineProperties(shape, {
    getScreenCTM: { value: () => ({ inverse: () => ({}) }) },
    isPointInFill: { value: (point: DOMPoint) =>
      point.x >= box.x0 && point.x <= box.x1 && point.y >= box.y0 && point.y <= box.y1 },
    isPointInStroke: { value: (point: DOMPoint) =>
      stroke !== undefined &&
      point.x >= stroke.x0 && point.x <= stroke.x1 &&
      point.y >= stroke.y0 && point.y <= stroke.y1 },
  })
}

describe('usePanelHover', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('follows the pointer across polygons and clears over the gutter', () => {
    const { result } = renderHook(() => usePanelHover(POLYS, [], {}))
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

  describe('a balloon, measured off the DOM', () => {
    // Every balloon is hit-tested against the outline PanelBubble actually drew —
    // the `.cb-bubble-hit` union of its shapes — never against its rectangular box.
    // This builds what the renderer would have built: panel 0's element holding one
    // visible balloon whose box hangs over the seam, with its outline covering only
    // x 90..115, y 10..40 of that box.
    function drawBalloon(
      over: { visible?: boolean; clipped?: boolean; puff?: Box; withHit?: boolean } = {},
    ): void {
      const panel = document.createElement('div')
      panel.className = 'cb-panel'
      panel.dataset.cbPanel = '0'
      const balloon = document.createElement('div')
      balloon.className = `cb-panel-bubble${over.visible === false ? '' : ' is-visible'}`
      const svg = document.createElementNS(SVG_NS, 'svg')
      svg.classList.add('cb-panel-bubble-svg')
      // The painted outline, which morphs on hover: it is *not* what the probe reads.
      const painted = document.createElementNS(SVG_NS, 'path')
      painted.classList.add('cb-bubble-shape')
      geometry(svg, painted, { x0: 0, x1: 200, y0: 0, y1: 100 })
      svg.appendChild(painted)
      if (over.withHit !== false) {
        const hit = document.createElementNS(SVG_NS, 'g')
        hit.classList.add('cb-bubble-hit')
        const ring = document.createElementNS(SVG_NS, 'path')
        geometry(svg, ring, { x0: 90, x1: 115, y0: 10, y1: 40 })
        hit.appendChild(ring)
        if (over.puff) {
          const puff = document.createElementNS(SVG_NS, 'circle')
          geometry(svg, puff, over.puff)
          hit.appendChild(puff)
        }
        svg.appendChild(hit)
      }
      balloon.appendChild(svg)
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

    it('keeps the hover while the pointer rides the drawn outline over the seam', () => {
      drawBalloon()
      const { result } = renderHook(() => usePanelHover(POLYS, [], {}))

      move(30, 20)
      expect(result.current).toBe(0)

      // (110, 20) is inside panel 1's polygon, but on the balloon panel 0 drew.
      move(110, 20)
      expect(result.current).toBe(0)

      // Still inside the balloon element's rectangular box, but outside its
      // outline: panel 1 takes the hover the moment the pointer leaves the ink.
      move(118, 20)
      expect(result.current).toBe(1)
      move(110, 45)
      expect(result.current).toBe(1)
    })

    it('reads the hit outline, not the painted one — a morphing outline must not release it', () => {
      // The painted path here covers the whole box; the hit union is the only thing
      // that says (118, 20) is off the balloon. If the probe read the painted path,
      // a hover-morph that pulls the outline from under a still cursor would
      // release the panel, hide the balloon, restore the outline, and loop.
      drawBalloon({ withHit: false })
      const { result } = renderHook(() => usePanelHover(POLYS, [], {}))

      move(30, 20)
      move(110, 20)
      expect(result.current).toBe(1)
    })

    it('counts a thought puff in the hit group as ink', () => {
      drawBalloon({ puff: { x0: 120, x1: 130, y0: 50, y1: 60 } })
      const { result } = renderHook(() => usePanelHover(POLYS, [], {}))

      move(30, 20)
      move(125, 55)
      expect(result.current).toBe(0)
    })

    it('does not stick to a balloon that is not shown', () => {
      drawBalloon({ visible: false })
      const { result } = renderHook(() => usePanelHover(POLYS, [], {}))

      move(30, 20)
      move(110, 20)
      expect(result.current).toBe(1)
    })

    it('does not stick to a clipped balloon — its ink stops at the panel edge', () => {
      drawBalloon({ clipped: true })
      const { result } = renderHook(() => usePanelHover(POLYS, [], {}))

      move(30, 20)
      move(110, 20)
      expect(result.current).toBe(1)
    })

    it('asks only the hovered panel — a neighbour’s hidden balloon cannot grab it', () => {
      drawBalloon()
      const { result } = renderHook(() => usePanelHover(POLYS, [], {}))

      // Arriving from panel 1's side, panel 0's balloon is not revealed.
      move(150, 80)
      expect(result.current).toBe(1)
      move(110, 20)
      expect(result.current).toBe(1)
    })
  })

  describe('a connector tube, measured off the DOM', () => {
    // A tube joining two of the hovered panel's balloons runs through the gutter and
    // is drawn only while both balloons show. It is that panel's ink, so the pointer
    // riding it between the two mouths keeps the hover exactly as the balloons do.
    /** One tube: a corridor filling x 100..130, y 50..60, with a rail stroked along its top. */
    function tubeElement(svg: SVGSVGElement, visible: boolean): SVGGElement {
      const tube = document.createElementNS(SVG_NS, 'g')
      tube.classList.add('cb-tube')
      if (visible) tube.classList.add('is-visible')
      const fill = document.createElementNS(SVG_NS, 'path')
      fill.classList.add('cb-tube-fill')
      geometry(svg, fill, { x0: 100, x1: 130, y0: 50, y1: 60 })
      tube.appendChild(fill)
      // The rail's own fill is `none`, and its stroke straddles the corridor's edge:
      // half over the fill, half — y 46..50 — over the neighbour's ground.
      const rail = document.createElementNS(SVG_NS, 'path')
      rail.classList.add('cb-tube-rail')
      geometry(svg, rail, { x0: 0, x1: 0, y0: 0, y1: 0 }, { x0: 100, x1: 130, y0: 46, y1: 54 })
      tube.appendChild(rail)
      return tube
    }

    /** A tube between two linked balloons: the viewport-level SVG, naming its panel. */
    function drawTube(over: { visible?: boolean; panel?: string } = {}): void {
      const svg = document.createElementNS(SVG_NS, 'svg')
      svg.classList.add('cb-tube-svg')
      const tube = tubeElement(svg, over.visible !== false)
      tube.dataset.cbPanel = over.panel ?? '0'
      svg.appendChild(tube)
      document.body.appendChild(svg)
    }

    /**
     * A chain's tube, as PanelBubbleChain draws it: on the chain's own SVG inside the
     * panel element, naming no panel — the element it is in says whose it is.
     */
    function drawChainTube(over: { panel?: string; clipped?: boolean } = {}): void {
      const panel = document.createElement('div')
      panel.className = 'cb-panel'
      panel.dataset.cbPanel = over.panel ?? '0'
      const layer = document.createElement('div')
      layer.className = 'cb-chain-layer'
      const svg = document.createElementNS(SVG_NS, 'svg')
      svg.classList.add('cb-chain-tubes')
      svg.appendChild(tubeElement(svg, true))
      layer.appendChild(svg)
      if (over.clipped) {
        const clip = document.createElement('div')
        clip.className = 'cb-bubble-clip'
        clip.appendChild(layer)
        panel.appendChild(clip)
      } else {
        panel.appendChild(layer)
      }
      document.body.appendChild(panel)
    }

    it('keeps the hover along a visible tube of the hovered panel', () => {
      drawTube()
      const { result } = renderHook(() => usePanelHover(POLYS, [], {}))

      move(30, 20)
      move(115, 55)
      expect(result.current).toBe(0)

      // Just off the corridor's fill: panel 1's ground.
      move(115, 65)
      expect(result.current).toBe(1)
    })

    it('ignores a faded tube, and one belonging to another panel', () => {
      drawTube({ visible: false })
      drawTube({ panel: '1' })
      const { result } = renderHook(() => usePanelHover(POLYS, [], {}))

      move(30, 20)
      move(115, 55)
      expect(result.current).toBe(1)
    })

    it('counts a rail — the visible edge stroked half outside the corridor', () => {
      drawTube()
      const { result } = renderHook(() => usePanelHover(POLYS, [], {}))

      move(30, 20)
      // Above the fill, on the rail's outer half: ink the reader can see.
      move(115, 47)
      expect(result.current).toBe(0)
      // Past the rail: the neighbour's ground.
      move(115, 44)
      expect(result.current).toBe(1)
    })

    it("keeps the hover along a chain's own tube, drawn inside the panel element", () => {
      drawChainTube()
      const { result } = renderHook(() => usePanelHover(POLYS, [], {}))

      move(30, 20)
      // (115, 55) is panel 1's polygon, on the link joining two of panel 0's rows.
      move(115, 55)
      expect(result.current).toBe(0)
      // And on its rail.
      move(115, 47)
      expect(result.current).toBe(0)

      move(115, 65)
      expect(result.current).toBe(1)
    })

    it("does not stick to a chain tube clipped to its panel, or to a neighbour's", () => {
      drawChainTube({ clipped: true })
      drawChainTube({ panel: '1' })
      const { result } = renderHook(() => usePanelHover(POLYS, [], {}))

      move(30, 20)
      move(115, 55)
      expect(result.current).toBe(1)
    })
  })

  it('clears the hover when the pointer leaves the document', () => {
    const { result } = renderHook(() => usePanelHover(POLYS, [], {}))

    move(30, 50)
    expect(result.current).toBe(0)

    act(() => {
      document.documentElement.dispatchEvent(new MouseEvent('mouseleave'))
    })
    expect(result.current).toBeNull()
  })

  it('stops listening on unmount', () => {
    const { result, unmount } = renderHook(() => usePanelHover(POLYS, [], {}))
    move(30, 50)
    expect(result.current).toBe(0)
    unmount()
    expect(() => move(150, 50)).not.toThrow()
  })
})
