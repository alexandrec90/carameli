import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { drawMarginRipple } from './benDayWash'
import { frameRect, OUTER_M } from './panelGeometry'
import type { Rect } from './panelGeometry'

// The letterbox. The page frame keeps a fixed aspect per window shape (panelGeometry.ts),
// so most windows leave a band of viewport either side of it or above and below. Rather
// than blank paper, those bands carry on the loading screen's Ben-Day ripple: the same
// grid, wave and clock as the sheet that was over the whole viewport a moment ago, so
// when the loading screen washes away the margins are already showing the ripple it
// showed, in phase, and only the page itself is new.
//
// The loop runs only while there is a band to draw — a window of the page's own aspect
// never schedules a frame — and draws one still frame under prefers-reduced-motion.

/**
 * The page sheet: the frame plus its outer margin, the paper the panels sit on. What
 * lies outside it on the viewport is the letterbox.
 */
export function pageSheet(w: number, h: number): Rect {
    const f = frameRect(w, h)
    return { x: f.x - OUTER_M, y: f.y - OUTER_M, w: f.w + 2 * OUTER_M, h: f.h + 2 * OUTER_M }
}

/** Whether the visitor asked for motion to be kept to a minimum. */
export function prefersReducedMotion(): boolean {
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface Viewport {
    w: number
    h: number
}

/**
 * Drives the letterbox ripple on the canvas the returned ref is mounted on. `active` is
 * whether the page is showing at all: while the loading sheet still covers the viewport
 * the same ripple is drawn there, and a second loop under it would be spent on nothing.
 */
export function useMarginRipple(
    viewport: Viewport, accent: string, active: boolean,
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
        const sheet = pageSheet(w, h)
        const still = prefersReducedMotion()
        const loop = () => {
            const drawn = drawMarginRipple(ctx, w, h, sheet, performance.now() / 1000, accent)
            if (drawn && !still) rafRef.current = requestAnimationFrame(loop)
        }
        loop()
        return () => cancelAnimationFrame(rafRef.current)
    }, [w, h, accent, active])

    return canvasRef
}

/** The letterbox canvas — the bottom layer of the page, under every panel. */
export default function MarginRipple({ viewport, accent, active }: {
    viewport: Viewport
    accent: string
    active: boolean
}) {
    const ref = useMarginRipple(viewport, accent, active)
    return <canvas ref={ref} className="cb-margin-canvas" aria-hidden="true" />
}
