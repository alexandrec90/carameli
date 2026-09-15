import type { CSSProperties } from 'react'

import { BUBBLE_VIEW, ELLIPSE, RING_POINTS, ringTheta } from './bubbleBox'
import { ringPoints } from './bubbleShape'
import { BUBBLE_TYPE_KEYS } from './editor/bubbleTypes'
import type { BubbleType } from './editor/bubbleTypes'

// Where the lettering goes inside a balloon: a rectangle that lies *inside the ink*, not
// inside the box the balloon is drawn in.
//
// The box is a rectangle and the balloon is not, so an inset chosen by eye put the block's
// corners outside the outline: a transcript filling its column ran its bottom lines out
// through the ellipse's shoulders. Rather than a tighter guess, the rectangle is derived
// from the same geometry that draws the outline — the largest axis-aligned rectangle that
// fits inside the ring of each type — so a shape that cuts further in (a thought cloud's
// cusps, a burst's valleys) letters in a smaller block, and the block follows the outline
// if the outline is ever retuned. Pure, no DOM, ships in prod; `bubbleFit.ts` wraps
// against the same numbers, which is what keeps a chain row's estimate and its drawing on
// one width.

/** The lettering block's inset, as fractions of the balloon box. Left and right are equal. */
export interface TextInset {
  top: number
  side: number
  bottom: number
}

/**
 * How far short of the outline the block stops, as a factor on the ellipse it is inscribed
 * in. The stroke is drawn centred on the ring, so its inner half sits inside it, and a
 * corner that touched the ring would touch ink.
 */
const TEXT_MARGIN = 0.96

/**
 * The scale of the base ellipse the lettering block is inscribed in for `type`: 1 for a
 * ring that is the ellipse, less for one whose outline cuts inside it.
 *
 * The block's corners sit on the diagonals, so the question at every ring vertex is
 * whether the block's edge at that vertex's angle lies inside the vertex — in the
 * normalised space where the ellipse is the unit circle, a square of half-side `s/√2` has
 * radius `(s/√2) / max(|cos θ|, |sin θ|)` along `θ`. Every type's outline is straight
 * edges between its vertices and so is the block, so the vertices are the whole check.
 */
export function textScale(type: BubbleType): number {
  const pts = ringPoints(type, 'none')
  let scale = 1
  for (let i = 0; i < RING_POINTS; i++) {
    const nx = (pts[i * 2] - ELLIPSE.cx) / ELLIPSE.rx
    const ny = (pts[i * 2 + 1] - ELLIPSE.cy) / ELLIPSE.ry
    const radius = Math.hypot(nx, ny)
    const theta = ringTheta(i)
    const reach = Math.max(Math.abs(Math.cos(theta)), Math.abs(Math.sin(theta)))
    scale = Math.min(scale, radius * Math.SQRT2 * reach)
  }
  return scale
}

/**
 * The largest axis-aligned rectangle inside the base ellipse scaled by `scale`: its
 * corners on the diagonals, half a side `scale · r / √2` on each axis.
 */
export function inscribedInset(scale: number): TextInset {
  const halfW = (scale * ELLIPSE.rx) / Math.SQRT2
  const halfH = (scale * ELLIPSE.ry) / Math.SQRT2
  return {
    top: (ELLIPSE.cy - halfH) / BUBBLE_VIEW.h,
    side: (ELLIPSE.cx - halfW) / BUBBLE_VIEW.w,
    bottom: 1 - (ELLIPSE.cy + halfH) / BUBBLE_VIEW.h,
  }
}

/** The lettering block per type, evaluated once: the shapes are constants. */
export const TEXT_INSETS: Readonly<Record<BubbleType, TextInset>> = Object.fromEntries(
  BUBBLE_TYPE_KEYS.map(type => [type, inscribedInset(textScale(type) * TEXT_MARGIN)]),
) as Record<BubbleType, TextInset>

/** Where the lettering block sits in a balloon of `type`. */
export function textInset(type: BubbleType): TextInset {
  return TEXT_INSETS[type]
}

/** A fraction of the box as CSS, to the precision a layout can tell apart. */
function pct(fraction: number): string {
  return `${Math.round(fraction * 10000) / 100}%`
}

/**
 * The block as the inline `inset` the lettering element carries, overriding the
 * stylesheet's fallback. Inline because it follows the balloon's *current* shape — a
 * hover that morphs a speech balloon into a thought cloud moves its words in with it.
 */
export function textInsetStyle(type: BubbleType): CSSProperties {
  const { top, side, bottom } = textInset(type)
  return { inset: `${pct(top)} ${pct(side)} ${pct(bottom)}` }
}
