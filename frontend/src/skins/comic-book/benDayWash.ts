// Ben-Day wash — the comic-book skin's page transition.
//
// A wave of paper-colored halftone dots sweeps diagonally from the top-left
// corner: dots grow until they merge into a solid sheet (cover), the sheet
// carries the paper's dot grid, then the same wave passes on and the dots
// shrink away to reveal the incoming page (reveal). The paper under the page
// draws the identical grid, so the sheet the wave leaves behind in the letterbox
// is the grid that was already there.
//
// The grid itself — where each dot is, how big it is under the light and what colour it
// prints in — is `benDayGrid.ts`, which every paper surface shares. This module is the
// wave that passes over it. The first load is not a wash: the page wipes in over the
// paper with no dots at all (`pageReveal.ts`).

import { clamp } from './editor/transforms'
import { drawGridDots, GRID_PAPER, GRID_SPACING } from './benDayGrid'
import type { SpotlightState } from './spotlight'

export const WASH_BAND = 220       // px depth of the growing/shrinking dot edge
export const WASH_COVER_MS = 420
export const WASH_HOLD_MS = 120
export const WASH_REVEAL_MS = 420
export const WASH_TOTAL_MS = WASH_COVER_MS + WASH_HOLD_MS + WASH_REVEAL_MS

// Dots on a square grid of spacing S merge into a solid plane at radius S·√2/2;
// the extra margin guarantees the sheet is fully opaque at cover = 1.
export const WASH_MERGE_RADIUS = GRID_SPACING * 0.75

export function easeInOutCubic(p: number): number {
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
}

export interface WashPhase {
    /** 0→1 eased progress of the covering wave front */
    cover: number
    /** 0→1 eased progress of the revealing wave front (starts after cover + hold) */
    reveal: number
    done: boolean
}

export function washPhaseAt(elapsedMs: number): WashPhase {
    const cover = easeInOutCubic(clamp(elapsedMs / WASH_COVER_MS, 0, 1))
    const reveal = easeInOutCubic(
        clamp((elapsedMs - WASH_COVER_MS - WASH_HOLD_MS) / WASH_REVEAL_MS, 0, 1),
    )
    return { cover, reveal, done: elapsedMs >= WASH_TOTAL_MS }
}

/**
 * Size factor (0..1) of the paper dot at diagonal distance `diag` (= x + y).
 * The cover front grows dots in a WASH_BAND-deep edge as it passes; the reveal
 * front shrinks them the same way. Both travel from diag 0 (top-left corner)
 * to maxDiag (bottom-right corner).
 */
export function dotGrowth(diag: number, cover: number, reveal: number, maxDiag: number): number {
    const span = maxDiag + WASH_BAND
    const kCover = clamp((cover * span - diag) / WASH_BAND, 0, 1)
    const kReveal = clamp((reveal * span - diag) / WASH_BAND, 0, 1)
    return Math.max(0, kCover - kReveal)
}

/**
 * One frame of the wash. Paper dots grow/shrink along the wave fronts; where
 * they have merged into a solid sheet, the lit grid plays on top.
 */
export function drawWash(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    cover: number, reveal: number, spot: SpotlightState, accentHex: string,
) {
    ctx.clearRect(0, 0, w, h)
    const maxDiag = w + h
    ctx.fillStyle = GRID_PAPER
    // Grid cells share diag = x + y along anti-diagonals, so caching dotGrowth by
    // diag (looked up again below by drawGridDots) avoids recomputing it per cell.
    const growthByDiag = new Map<number, number>()
    const growthAt = (diag: number): number => {
        let growth = growthByDiag.get(diag)
        if (growth === undefined) {
            growth = dotGrowth(diag, cover, reveal, maxDiag)
            growthByDiag.set(diag, growth)
        }
        return growth
    }
    for (let x = GRID_SPACING / 2; x < w; x += GRID_SPACING) {
        for (let y = GRID_SPACING / 2; y < h; y += GRID_SPACING) {
            const growth = growthAt(x + y)
            if (growth <= 0) continue
            ctx.beginPath()
            ctx.arc(x, y, growth * WASH_MERGE_RADIUS, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    drawGridDots(ctx, { x: 0, y: 0, w, h }, spot, accentHex,
        diag => clamp((growthAt(diag) - 0.8) / 0.2, 0, 1))
}
