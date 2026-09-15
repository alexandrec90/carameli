import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { drawMarginRipple } from './benDayWash'
import { OUTER_M } from './panelGeometry'
import type { Rect } from './panelGeometry'
import type { Viewport } from './usePageFrame'

// The letterbox. The page frame keeps a fixed aspect per window shape (panelGeometry.ts),
// so most windows leave a band of viewport either side of it or above and below. Rather
// than blank paper, those bands carry on the loading screen's Ben-Day ripple: the same
// grid, wave and clock as the sheet that was over the whole viewport a moment ago, so
// when the loading screen washes away the margins are already showing the ripple it
// showed, in phase, and only the page itself is new.
//
// The loop runs only while there is a band to draw — a window of the page's own aspect
// never schedules a frame. It does not consult prefers-reduced-motion: the loading
// ripple it continues does not either, and a sheet that moves until the page is up and
// then stops reads as the page having frozen, not as a preference honoured.

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
 * Drives the letterbox ripple on the canvas the returned ref is mounted on. `active` is
 * whether the page is showing at all: while the loading sheet still covers the viewport
 * the same ripple is drawn there, and a second loop under it would be spent on nothing.
 */
export function useMarginRipple(
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
        const loop = () => {
            const drawn = drawMarginRipple(ctx, w, h, sheet, performance.now() / 1000, accent)
            if (drawn) rafRef.current = requestAnimationFrame(loop)
        }
        loop()
        return () => cancelAnimationFrame(rafRef.current)
    }, [w, h, frame, accent, active])

    return canvasRef
}

/** The letterbox canvas — the bottom layer of the page, under every panel. */
export default function MarginRipple({ viewport, frame, accent, active }: {
    viewport: Viewport
    frame: Rect
    accent: string
    active: boolean
}) {
    const ref = useMarginRipple(viewport, frame, accent, active)
    return <canvas ref={ref} className="cb-margin-canvas" aria-hidden="true" />
}
