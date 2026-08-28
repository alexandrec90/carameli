import { useEffect, useMemo, useRef } from 'react'
import { frameDelta, restClock, stepPanelDots } from './panelDotAnim'
import { PATTERN_STYLE_KEYS, drawPanelBackground, panelBgConfig } from './panelPatterns'
import type { PanelBgStyle } from './panelPatterns'

/**
 * Drives every panel's Ben-Day dot canvas from one rAF loop, and returns the ref
 * callback each panel hands its canvas.
 *
 * Only the active (hovered) panel is repainted per frame; the rest keep the frame
 * they froze on, which is both the look the skin asks for and the reason this loop
 * costs one panel's worth of drawing rather than eight. What "froze on" means, and
 * why it is not wall time, is panelDotAnim.ts.
 *
 * `patterns` is one style per panel, so its length is the panel count — which the
 * editor can grow by splitting a panel, so every per-panel table here is filled in
 * lazily rather than sized once on mount.
 */
export function usePanelDots(
    patterns: PanelBgStyle[], hovered: number | null,
): ((el: HTMLCanvasElement | null) => void)[] {
    const count = patterns.length
    const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
    const clocksRef = useRef<number[]>([])
    // A panel is dirty when its canvas shows something other than the frame its
    // clock names: freshly mounted, resized, or handed a different pattern.
    const dirtyRef = useRef<boolean[]>([])
    const prevMsRef = useRef<number | null>(null)

    // The loop outlives any one render, so it reads both of these through refs
    // rather than a closure. Written from effects (never during render): the
    // commit lands before the next frame, which is the earliest the loop looks.
    const patternsRef = useRef(patterns)
    useEffect(() => {
        patternsRef.current = patterns
        dirtyRef.current = dirtyRef.current.map(() => true)
    }, [patterns])

    const hoveredRef = useRef(hovered)
    useEffect(() => { hoveredRef.current = hovered }, [hovered])

    // Stable per-index callbacks. An inline arrow would be a new function every
    // render, which React answers by detaching and reattaching the canvas — a
    // remount storm for a loop that keys its work off canvas identity. Rebuilt only
    // when the panel count changes, which remounts every canvas once; each is marked
    // dirty on attach, so they all repaint their still frame.
    const dotRefs = useMemo(
        () => Array.from({ length: count }, (_, i) => (el: HTMLCanvasElement | null) => {
            canvasRefs.current[i] = el
            if (el) dirtyRef.current[i] = true
        }),
        [count],
    )

    // Everything below reads only refs, so the loop mounts once and never restarts.
    // Both functions are declarations rather than consts: `frame` queues itself.
    useEffect(() => {
        let raf = 0

        function paintPanel(i: number, dt: number) {
            const canvas = canvasRefs.current[i]
            if (!canvas) return
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            const ow = canvas.offsetWidth
            const oh = canvas.offsetHeight
            if (ow > 0 && oh > 0 && (canvas.width !== ow || canvas.height !== oh)) {
                canvas.width = ow
                canvas.height = oh
                // Resizing the backing store blanks it, whatever the clock says.
                dirtyRef.current[i] = true
            }
            if (canvas.width === 0 || canvas.height === 0) return
            // First sight of this index: its clock starts at rest and it needs a paint.
            const clock = clocksRef.current[i] ?? restClock(i)
            const step = stepPanelDots(
                clock, hoveredRef.current === i, dt, dirtyRef.current[i] ?? true,
            )
            clocksRef.current[i] = step.clock
            if (!step.paint) return
            dirtyRef.current[i] = false
            drawPanelBackground(
                ctx, canvas.width, canvas.height,
                patternsRef.current[i] ?? PATTERN_STYLE_KEYS[0], panelBgConfig(i), step.clock,
            )
        }

        function frame(nowMs: number) {
            const dt = frameDelta(prevMsRef.current, nowMs)
            prevMsRef.current = nowMs
            for (let i = 0; i < patternsRef.current.length; i++) paintPanel(i, dt)
            raf = requestAnimationFrame(frame)
        }

        raf = requestAnimationFrame(frame)
        return () => {
            cancelAnimationFrame(raf)
            prevMsRef.current = null
        }
    }, [])

    return dotRefs
}
