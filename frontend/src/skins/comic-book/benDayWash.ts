// Ben-Day wash — the comic-book skin's page-transition and loading-screen effect.
//
// A wave of paper-colored halftone dots sweeps diagonally from the top-left
// corner: dots grow until they merge into a solid sheet (cover), the sheet
// carries the loading screen's Ben-Day ripple, then the same wave passes on
// and the dots shrink away to reveal the incoming page (reveal). The loading
// overlay draws the identical ripple on the identical grid, so the transition
// sheet and the loading screen hand off seamlessly.

import { clamp } from './editor/transforms'

export const WASH_SPACING = 20     // px between dot centres (grid shared with the ripple)
export const WASH_BAND = 220       // px depth of the growing/shrinking dot edge
export const WASH_COVER_MS = 420
export const WASH_HOLD_MS = 120
export const WASH_REVEAL_MS = 420
export const WASH_TOTAL_MS = WASH_COVER_MS + WASH_HOLD_MS + WASH_REVEAL_MS

// Dots on a square grid of spacing S merge into a solid plane at radius S·√2/2;
// the extra margin guarantees the sheet is fully opaque at cover = 1.
export const WASH_MERGE_RADIUS = WASH_SPACING * 0.75

export const RIPPLE_WAVE_LEN = 260 // px between crests along the x+y diagonal
export const RIPPLE_SPEED = 0.55   // crest cycles per second (top-left → bottom-right)
export const RIPPLE_BASE_R = 4.5   // max ripple dot radius

export const WASH_PAPER = '#FAFAF2'

export function parseCssColor(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return [r, g, b]
}

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

/** Ripple wave height (0..1) at diagonal distance `diag`, time `tSec`. */
export function rippleWave(diag: number, tSec: number): number {
    const phase = (diag / RIPPLE_WAVE_LEN) * Math.PI * 2 - tSec * RIPPLE_SPEED * Math.PI * 2
    return (Math.sin(phase) + 1) / 2
}

// Ripple dots over the paper sheet. `gate` (0..1 per diagonal distance) fades the
// ripple out where the sheet is not fully merged, so it never floats over raw page.
function drawRippleDots(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    tSec: number, accentHex: string, gate: (diag: number) => number,
) {
    const [r, g, b] = parseCssColor(accentHex)
    for (let x = WASH_SPACING / 2; x < w; x += WASH_SPACING) {
        for (let y = WASH_SPACING / 2; y < h; y += WASH_SPACING) {
            const gt = gate(x + y)
            if (gt <= 0) continue
            const wave = rippleWave(x + y, tSec)
            const radius = RIPPLE_BASE_R * (0.12 + 0.88 * wave)
            const alpha = (0.12 + 0.68 * wave) * gt
            ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`
            ctx.beginPath()
            ctx.arc(x, y, Math.max(0.3, radius), 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

/** Loading-screen background: solid paper + the full Ben-Day ripple. */
export function drawLoadingRipple(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    tSec: number, accentHex: string,
) {
    ctx.fillStyle = WASH_PAPER
    ctx.fillRect(0, 0, w, h)
    drawRippleDots(ctx, w, h, tSec, accentHex, () => 1)
}

/**
 * One frame of the wash. Paper dots grow/shrink along the wave fronts; where
 * they have merged into a solid sheet, the loading ripple plays on top.
 */
export function drawWash(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    cover: number, reveal: number, tSec: number, accentHex: string,
) {
    ctx.clearRect(0, 0, w, h)
    const maxDiag = w + h
    ctx.fillStyle = WASH_PAPER
    // Grid cells share diag = x + y along anti-diagonals, so caching dotGrowth by
    // diag (looked up again below by drawRippleDots) avoids recomputing it per cell.
    const growthByDiag = new Map<number, number>()
    const growthAt = (diag: number): number => {
        let growth = growthByDiag.get(diag)
        if (growth === undefined) {
            growth = dotGrowth(diag, cover, reveal, maxDiag)
            growthByDiag.set(diag, growth)
        }
        return growth
    }
    for (let x = WASH_SPACING / 2; x < w; x += WASH_SPACING) {
        for (let y = WASH_SPACING / 2; y < h; y += WASH_SPACING) {
            const growth = growthAt(x + y)
            if (growth <= 0) continue
            ctx.beginPath()
            ctx.arc(x, y, growth * WASH_MERGE_RADIUS, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    drawRippleDots(ctx, w, h, tSec, accentHex,
        diag => clamp((growthAt(diag) - 0.8) / 0.2, 0, 1))
}
