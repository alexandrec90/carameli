import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { tailRingIndex } from './bubbleBox'
import type { TailDir } from './bubbleBox'
import { easeOutCubic, lerpPoints, pathD, ringPoints } from './bubbleShape'
import type { BubbleType } from './editor/bubbleTypes'

/** Morph duration — long enough to read as a transformation, short enough to snap. */
export const MORPH_MS = 240

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Drive one `<path>` through the shape morph for `target`, with its tail on the `tail`
 * side, returning the ref to attach to it.
 *
 * The tail is a morph target like the shape is: it lives on the same ring, so turning
 * a tail from `down-left` to `right` — or removing it — travels the vertices instead
 * of cutting. That matters in the editor, where the tail dropdown is a live control.
 *
 * `d` is written straight to the DOM from a rAF loop rather than rendered from
 * React state: 64 vertices × 60 fps × one bubble per panel is a re-render storm
 * React has no reason to see, and the skin already drives its Ben-Day canvases the
 * same way. So the path must carry NO `d` prop — this hook owns the attribute, and
 * a layout effect writes the first frame before the browser paints. A React-rendered
 * `d` would fight the loop and snap the shape mid-morph.
 *
 * Interrupting works by construction: the target changing cancels the in-flight
 * frame and the next run starts from whatever vertices were last written, so a
 * shape change part-way through a morph continues from there instead of jumping.
 */
export function useBubbleMorph(
  target: BubbleType,
  tail: TailDir,
  tailTarget?: [number, number],
): RefObject<SVGPathElement | null> {
  const pathRef = useRef<SVGPathElement | null>(null)
  const currentRef = useRef<number[]>(ringPoints(target, tail))
  const rafRef = useRef(0)
  const firstRef = useRef(true)
  const targetX = tailTarget?.[0]
  const targetY = tailTarget?.[1]

  useLayoutEffect(() => {
    const path = pathRef.current
    if (!path) return

    const from = currentRef.current
    const to = ringPoints(target, tail)
    if (targetX !== undefined && targetY !== undefined) {
      const i = tailRingIndex(tail) * 2
      ;[to[i], to[i + 1]] = [targetX, targetY]
    }
    const settle = (pts: number[]): void => {
      currentRef.current = pts
      path.setAttribute('d', pathD(pts))
    }

    // Nothing to animate on mount (from === to), and nothing to animate for a
    // reader who asked for less motion — both just take the target shape.
    if (firstRef.current || prefersReducedMotion()) {
      firstRef.current = false
      settle(to)
      return
    }

    const start = performance.now()
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / MORPH_MS)
      settle(lerpPoints(from, to, easeOutCubic(t)))
      if (t < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, tail, targetX, targetY])

  return pathRef
}
