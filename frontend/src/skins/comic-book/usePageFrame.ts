import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import type { LayoutKind, PanelGrid, PanelPoly, Rect } from './panelGeometry'
import { frameRect, gridPolys, layoutKindFor } from './panelGeometry'

// The one place the window's size enters the skin. Everything drawn is a fraction of
// the page frame, and the frame is a fixed-aspect rectangle letterboxed into the
// window, so the window is an input to exactly one thing — where the frame sits and how
// big it is — and nothing downstream reads `innerWidth` again.

/** The window's size in px, as the one thing this module reads off it. */
export interface Viewport {
  w: number
  h: number
}

/** The page frame a render is drawn in, and the shape it was chosen for. */
export interface PageFrame {
  /** Which of the three grids is drawn. The window's, unless the editor is holding one. */
  kind: LayoutKind
  /** The frame in viewport px; zero-size before the window has reported. */
  frame: Rect
  /**
   * The window the frame was fitted into. Handed out for what is drawn *outside* the
   * frame — the letterbox — so that consumer need not read the window itself.
   */
  viewport: Viewport
}

/**
 * The frame for a window of `w × h`, drawn at `override`'s shape when the editor is
 * holding one, else at the window's own. Pure; the hook below is this over a resize
 * listener.
 */
export function pageFrameFor(w: number, h: number, override: LayoutKind | null): PageFrame {
  const kind = override ?? layoutKindFor(w, h)
  return { kind, frame: frameRect(w, h, kind), viewport: { w, h } }
}

/**
 * One page's panels drawn in a frame, sparse and PANELS-length: a panel on the other
 * page has an empty ring in this page's grid, which gridPolys returns as a vertex-less
 * polygon — mapped to null here so every consumer can tell "not on this page" from a
 * real shape. Nothing at all before the window has reported a size.
 */
export function panelPolysIn(grid: PanelGrid, frame: Rect): (PanelPoly | null)[] {
  if (frame.w <= 0 || frame.h <= 0) return []
  return gridPolys(grid, frame).map(p => (p.vp.length >= 3 ? p : null))
}

/**
 * Balloon lettering is sized off the frame, as the balloons themselves are, so words
 * and balloon scale together in every window. The frame's *height* is the unit rather
 * than its width because the three shapes share a height in a given window — a
 * portrait frame is a narrow slice of the same monitor — so switching shape leaves the
 * type size alone. `--cb-lettering` in `comic-book.css` is the multiple of this.
 */
export const FRAME_HEIGHT_VAR = '--cb-frame-h'

/** The inline style that hands the frame to the stylesheet. */
export function pageFrameStyle(frame: Rect): CSSProperties {
  return { [FRAME_HEIGHT_VAR]: `${frame.h}px` } as CSSProperties
}

/**
 * The current page frame, following window resizes. Held as the *viewport* and derived,
 * rather than as computed polygons in state: what the frame decides (panels, pictures,
 * balloons, the editor's targets) re-derives on every render for free, which is what
 * lets a seam drag or a shape switch repaint without a resize.
 */
export function usePageFrame(override: LayoutKind | null): PageFrame {
  const [viewport, setViewport] = useState<Viewport>(() =>
    typeof window === 'undefined' ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight })

  const handleResize = useCallback(() => {
    const w = window.innerWidth
    const h = window.innerHeight
    setViewport(prev => (prev.w === w && prev.h === h ? prev : { w, h }))
  }, [])

  useLayoutEffect(() => { handleResize() }, [handleResize])

  useEffect(() => {
    window.addEventListener('resize', handleResize)
    return () => { window.removeEventListener('resize', handleResize) }
  }, [handleResize])

  // Memoised so the frame's identity only changes when its numbers do: the panel
  // polygons are derived from it, and re-deriving them on every render would repaint
  // every canvas.
  return useMemo(
    () => pageFrameFor(viewport.w, viewport.h, override),
    [viewport.w, viewport.h, override],
  )
}
