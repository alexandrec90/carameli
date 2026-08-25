import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { drawWash, washPhaseAt } from './benDayWash'

/**
 * Page transition — the Ben-Day wash. A halftone wave sweeps from the top-left
 * corner: paper dots grow until they merge into a solid sheet carrying the loading
 * screen's ripple, then the wave passes on and the dots shrink away to reveal the
 * new page. Returns the ref Layout mounts on its wash canvas (blank when idle).
 */
export function usePageWash(pathname: string, accent: string): RefObject<HTMLCanvasElement | null> {
    const washRef = useRef<HTMLCanvasElement | null>(null)
    const washRafRef = useRef<number>(0)
    const prevPathRef = useRef(pathname)

    useEffect(() => {
        if (pathname === prevPathRef.current) return
        prevPathRef.current = pathname

        const canvas = washRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight

        const start = performance.now()
        cancelAnimationFrame(washRafRef.current)
        const loop = (now: number) => {
            const { cover, reveal, done } = washPhaseAt(now - start)
            drawWash(ctx, canvas.width, canvas.height, cover, reveal, now / 1000, accent)
            if (done) {
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                return
            }
            washRafRef.current = requestAnimationFrame(loop)
        }
        washRafRef.current = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(washRafRef.current)
    }, [pathname, accent])

    return washRef
}
