import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { drawMarginGrid } from './benDayWash'
import { OUTER_M } from './panelGeometry'
import type { Rect } from './panelGeometry'
import { pageSpotlight } from './spotlight'
import type { SpotlightState } from './spotlight'
import type { Viewport } from './usePageFrame'

// The letterbox. The page frame keeps a fixed aspect per window shape (panelGeometry.ts),
// so most windows leave a band of viewport either side of it or above and below. Rather
// than blank paper, those bands carry on the loading screen's Ben-Day grid: the same
// dots, lit by the same spotlight, so when the loading screen washes away the margins
// are already showing what it showed, lit where it was lit, and only the page itself
// is new.
//
// The loop runs only while there is a band to draw — a window of the page's own aspect
// never schedules a frame — and repaints only on a frame the light moved, so a resting
// pointer costs nothing but the frame callback. It does not consult
// prefers-reduced-motion: the grid moves only as the pointer does (spotlight.ts).

/**
 * The page sheet: the frame plus its outer margin, the paper the panels sit on. What
 * lies outside it on the viewport is the letterbox. Taken from the frame actually
 * drawn (usePageFrame.ts) rather than refitted from the window, so a page the editor
 * is holding at another shape gets its letterbox where its sheet is.
 */
export function pageSheet(frame: Rect): Rect {
    return {
        x: frame.x - OUTER_M,
        y: frame.y - OUTER_M,
        w: frame.w + 2 * OUTER_M,
        h: frame.h + 2 * OUTER_M,
    }
}

/**
 * Drives the letterbox grid on the canvas the returned ref is mounted on. `active` is
 * whether the page is showing at all: while the loading sheet still covers the viewport
 * the same grid is drawn there, and a second loop under it would be spent on nothing.
 */
export function useMarginGrid(
    viewport: Viewport, frame: Rect, accent: string, active: boolean,
): RefObject<HTMLCanvasElement | null> {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const rafRef = useRef<number>(0)
    const { w, h } = viewport

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        // Sizing the bitmap clears it, which is the whole of the inactive case.
        canvas.width = w
        canvas.height = h
        if (!active || w <= 0 || h <= 0) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const sheet = pageSheet(frame)
        const spotlight = pageSpotlight()
        let shown: SpotlightState = spotlight.sample(performance.now())
        // Nothing to draw means nothing to follow: no listener, no frame.
        if (!drawMarginGrid(ctx, w, h, sheet, shown, accent)) return
        const release = spotlight.acquire()
        const loop = (now: number) => {
            const spot = spotlight.sample(now)
            if (spot !== shown) {
                shown = spot
                drawMarginGrid(ctx, w, h, sheet, spot, accent)
            }
            rafRef.current = requestAnimationFrame(loop)
        }
        rafRef.current = requestAnimationFrame(loop)
        return () => {
            cancelAnimationFrame(rafRef.current)
            release()
        }
    }, [w, h, frame, accent, active])

    return canvasRef
}

/** The letterbox canvas — the bottom layer of the page, under every panel. */
export default function MarginGrid({ viewport, frame, accent, active }: {
    viewport: Viewport
    frame: Rect
    accent: string
    active: boolean
}) {
    const ref = useMarginGrid(viewport, frame, accent, active)
    return <canvas ref={ref} className="cb-margin-canvas" aria-hidden="true" />
}
