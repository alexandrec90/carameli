import { useEffect, useState } from 'react'

import { hoveredPanelAt } from './panelHover'
import type { ImgTransform } from './editor/types'
import type { PanelPoly } from './panelGeometry'

/**
 * Whether the viewport point is inside the fill of an SVG shape, in that shape's own
 * space. False wherever the geometry API is missing — a test DOM has none — rather
 * than a throw from inside a pointermove listener.
 */
function shapeHolds(svg: SVGSVGElement, shape: SVGGeometryElement, x: number, y: number): boolean {
  if (typeof shape.getScreenCTM !== 'function' || typeof shape.isPointInFill !== 'function') {
    return false
  }
  const matrix = shape.getScreenCTM()
  if (!matrix) return false
  const point = svg.createSVGPoint()
  if (typeof point.matrixTransform !== 'function') return false
  point.x = x
  point.y = y
  return shape.isPointInFill(point.matrixTransform(matrix.inverse()))
}

/**
 * Whether the pointer sits on ink `panel` has actually drawn: a shown, unclipped
 * balloon of its own, or a connector tube joining two of them.
 *
 * Measured off the rendered SVG rather than off any transform, for two reasons. A
 * balloon's element is a rectangle around an ellipse and a tail — most of it is empty,
 * and a hover that counted the empty part stuck after the pointer had visibly reached
 * the panel below. And a chain's balloons are stamped rows whose places only the
 * renderer knows (see bubbleChain.ts). So both are asked the same question of the same
 * geometry, and the answer is exact for both.
 *
 * What is measured is the balloon's **hit region** (`.cb-bubble-hit`, see PanelBubble
 * and hitRingPoints), not its painted outline. The region is the union of every shape
 * the balloon can morph into, so it never moves out from under a still cursor — the
 * painted outline does, when a hover swaps a soft balloon for a thought cloud whose
 * cusps cut inside it, and reading that would release the panel, hide the balloon,
 * restore the outline and loop. It is also the very region the balloon's own hover
 * and click answer to, so the panel stays lit exactly while the balloon is live.
 */
function overDrawnInk(x: number, y: number, panel: number): boolean {
  const host = document.querySelector(`.cb-panel[data-cb-panel="${panel}"]`)
  if (host) {
    for (const el of host.querySelectorAll('.cb-panel-bubble.is-visible')) {
      if (el.closest('.cb-bubble-clip')) continue
      const svg = el.querySelector<SVGSVGElement>('.cb-panel-bubble-svg')
      if (!svg || typeof svg.createSVGPoint !== 'function') continue
      for (const shape of svg.querySelectorAll<SVGGeometryElement>('.cb-bubble-hit > *')) {
        if (shapeHolds(svg, shape, x, y)) return true
      }
    }
  }
  // Tubes live on one viewport-level SVG, outside every panel element; each names
  // the panel whose balloons it joins. Only the fill: a tube's rails are its edges.
  for (const tube of document.querySelectorAll(
    `.cb-tube.is-visible[data-cb-panel="${panel}"] .cb-tube-fill`)) {
    const svg = tube.closest<SVGSVGElement>('svg')
    if (!svg || typeof svg.createSVGPoint !== 'function') continue
    if (shapeHolds(svg, tube as SVGGeometryElement, x, y)) return true
  }
  return false
}

/**
 * The hovered panel, decided by geometry rather than by whichever panel element the
 * browser hit-tested (see panelHover.ts for why the elements cannot be trusted). One
 * window-level listener replaces a mouseenter/mouseleave pair per panel: every move is
 * answered from the polygons, so the panels' overlapping bounding boxes never vote.
 *
 * The previous answer feeds the next one — that is the sticky-ink rule: a balloon
 * revealed by this hover keeps the hover while the pointer rides its outline over the
 * seam, and releases it the moment the pointer steps off. Leaving the document clears
 * it, so a pointer that exits by a spilled balloon does not leave its panel lit forever.
 */
export function usePanelHover(
  polys: (PanelPoly | null)[],
  images: ImgTransform[],
  natSizes: Record<string, { w: number; h: number }>,
): number | null {
  const [hovered, setHovered] = useState<number | null>(null)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      setHovered(prev =>
        hoveredPanelAt(e.clientX, e.clientY, polys, images, natSizes, prev, overDrawnInk))
    }
    const onLeave = () => setHovered(null)
    window.addEventListener('pointermove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [polys, images, natSizes])
  return hovered
}
