import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { slowLoaderDelay } from '../../lib/slowLoading'
import { runBenDayGrid } from './benDayGrid'
import { drawWash, washPhaseAt, WASH_COVER_MS, WASH_HOLD_MS } from './benDayWash'
import { pageSpotlight } from './spotlight'

// The comic-book loading screen: a full-viewport sheet of Ben-Day dots lit by the
// pointer's spotlight, with a "LOADING…" legend, shown while the page's pictures are
// still settling, washed away with the same Ben-Day reveal a page transition uses. The
// state machine lives in useLoadingScreen; LoadingOverlay is only the sheet itself.

/** Everything Layout needs to run and render the loading screen. */
export interface LoadingScreen {
    /** True while the sheet should be up (assets loading, or editor preview). */
    loadingActive: boolean
    /** True while the sheet is being washed away to reveal the ready page. */
    loadingLeaving: boolean
    /** Dev editor: whether the loading-screen preview toggle is on. */
    previewLoading: boolean
    /** Dev editor toggle — leaving the preview replays the exit wash. */
    handlePreviewLoading(on: boolean): void
    dotCount: number
    canvasRef: RefObject<HTMLCanvasElement | null>
}

/**
 * State + animation loops for the loading screen. `ready` is "every picture on the
 * page has loaded or errored"; `accent` colours the grid and the exit wash.
 */
export function useLoadingScreen(ready: boolean, accent: string): LoadingScreen {
    // 0 on first visit (no cache), 400 on return visits (assets likely cached), 0 again
    // under `?slow=1` — a sheet held up for a second that spends 400 ms of it waiting to
    // appear is not the sheet the brake was turned on to watch.
    const loaderDelay = slowLoaderDelay(localStorage.getItem('comic-book:loaded') ? 400 : 0)
    const [showLoading, setShowLoading] = useState(false)
    // True while the loading sheet is being washed away to reveal the ready page.
    const [loadingLeaving, setLoadingLeaving] = useState(false)
    // Dev editor: force-show the loading screen so it can be previewed/tuned.
    const [previewLoading, setPreviewLoading] = useState(false)

    const canvasRef = useRef<HTMLCanvasElement | null>(null)

    // The loading overlay is live while assets load — or while the editor previews it.
    const loadingActive = (showLoading && !ready) || previewLoading

    // Editor toggle for the loading-screen preview: leaving it replays the exit
    // wash; entering it cancels any in-flight exit so the sheet stays put.
    const handlePreviewLoading = (on: boolean) => {
        if (on === previewLoading) return
        setLoadingLeaving(!on)
        setPreviewLoading(on)
    }

    // Show "LOADING" after loaderDelay — 0 on first visit, 400 ms on return visits.
    // When the page becomes ready while the overlay is up, hand off to the leave
    // wash instead of snapping the overlay away.
    useEffect(() => {
        if (ready) {
            localStorage.setItem('comic-book:loaded', '1')
            if (showLoading) {
                setShowLoading(false)
                setLoadingLeaving(true)
            }
            return
        }
        if (showLoading) return
        const timer = setTimeout(() => setShowLoading(true), loaderDelay)
        return () => clearTimeout(timer)
    }, [ready, showLoading, loaderDelay])

    const dotCount = useDotCycle(loadingActive)
    // The same grid, off the same loop, that `skins/context.tsx` has been drawing behind
    // the skin's own chunk: this sheet takes the handoff mid-light, and nothing under the
    // legend changes at the moment the chunk lands.
    useEffect(() => {
        const canvas = canvasRef.current
        if (!loadingActive || !canvas) return
        return runBenDayGrid(canvas, accent)
    }, [loadingActive, accent])

    useLeaveWash(loadingLeaving, canvasRef, accent, setLoadingLeaving)

    return { loadingActive, loadingLeaving, previewLoading, handlePreviewLoading, dotCount, canvasRef }
}

/** Cycling dots (1 → 2 → 3 → 1…) after the legend, while the sheet is up. */
function useDotCycle(active: boolean): number {
    const [dotCount, setDotCount] = useState(1)
    useEffect(() => {
        if (!active) return
        setDotCount(1)
        const id = setInterval(() => setDotCount(d => d === 3 ? 1 : d + 1), 450)
        return () => clearInterval(id)
    }, [active])
    return dotCount
}

/**
 * Exit: wash the grid sheet away to reveal the page. Reuses the wash's reveal
 * phase (cover pinned at 1) so the loading screen ends exactly the way a page
 * transition does. `setLeaving` is a `useState` setter, so it is stable.
 */
function useLeaveWash(
    leaving: boolean,
    canvasRef: RefObject<HTMLCanvasElement | null>,
    accent: string,
    setLeaving: (on: boolean) => void,
) {
    const rafRef = useRef<number>(0)
    useEffect(() => {
        if (!leaving) return
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) { setLeaving(false); return }
        const start = performance.now()
        const spotlight = pageSpotlight()
        const release = spotlight.acquire()
        const loop = (now: number) => {
            const { reveal, done } = washPhaseAt(WASH_COVER_MS + WASH_HOLD_MS + (now - start))
            drawWash(ctx, canvas.width, canvas.height, 1, reveal, spotlight.sample(now), accent)
            if (done) {
                release()
                setLeaving(false)
                return
            }
            rafRef.current = requestAnimationFrame(loop)
        }
        rafRef.current = requestAnimationFrame(loop)
        return () => {
            cancelAnimationFrame(rafRef.current)
            release()
        }
    }, [leaving, accent, canvasRef, setLeaving])
}

/**
 * The loading sheet. Rendered outside cb-root so it is visible while the page is
 * opacity:0; stays mounted through the leave wash so the sheet can wash away over
 * the revealed page.
 */
export function LoadingOverlay({ screen }: { screen: LoadingScreen }) {
    const { loadingActive, loadingLeaving, dotCount, canvasRef } = screen
    if (!loadingActive && !loadingLeaving) return null
    return (
        <div
            className={`cb-loading-overlay${loadingLeaving ? ' cb-loading-leaving' : ''}`}
            aria-live="polite"
        >
            <canvas ref={canvasRef} className="cb-loading-canvas" />
            <span className="cb-loading-text">
                LOADING<span className="cb-loading-dots" aria-hidden="true">
                    <span style={{ opacity: dotCount >= 1 ? 1 : 0 }}>.</span>
                    <span style={{ opacity: dotCount >= 2 ? 1 : 0 }}>.</span>
                    <span style={{ opacity: dotCount >= 3 ? 1 : 0 }}>.</span>
                </span>
            </span>
        </div>
    )
}
