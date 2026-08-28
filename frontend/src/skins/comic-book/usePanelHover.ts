import { useEffect, useState } from 'react'

import { hoveredPanelAt } from './panelHover'
import type { BubbleTransform, ImgTransform } from './editor/types'
import type { PanelPoly } from './panelGeometry'

/**
 * The hovered panel, decided by geometry rather than by whichever panel element the
 * browser hit-tested (see panelHover.ts for why the elements cannot be trusted). One
 * window-level listener replaces a mouseenter/mouseleave pair per panel: every move is
 * answered from the polygons, so the panels' overlapping bounding boxes never vote.
 *
 * The previous answer feeds the next one — that is the sticky-spill rule: a balloon
 * revealed by this hover keeps the hover while the pointer rides it over the seam.
 * Leaving the document clears it, so a pointer that exits by a spilled balloon does
 * not leave its panel lit forever.
 */
export function usePanelHover(
  polys: (PanelPoly | null)[],
  images: ImgTransform[],
  bubbles: BubbleTransform[],
  natSizes: Record<string, { w: number; h: number }>,
): number | null {
  const [hovered, setHovered] = useState<number | null>(null)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      setHovered(prev =>
        hoveredPanelAt(e.clientX, e.clientY, polys, images, bubbles, natSizes, prev))
    }
    const onLeave = () => setHovered(null)
    window.addEventListener('pointermove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [polys, images, bubbles, natSizes])
  return hovered
}
