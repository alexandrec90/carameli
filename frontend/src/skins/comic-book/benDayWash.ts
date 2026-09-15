// Ben-Day wash — the comic-book skin's page-transition and loading-screen exit.
//
// A wave of paper-colored halftone dots sweeps diagonally from the top-left
// corner: dots grow until they merge into a solid sheet (cover), the sheet
// carries the loading screen's dot grid, then the same wave passes on and the
// dots shrink away to reveal the incoming page (reveal). The loading overlay
// draws the identical grid, so the transition sheet and the loading screen hand
// off seamlessly.
//
// The grid itself — where each dot is, how big it is under the light and what colour it
// prints in — is `benDayGrid.ts`, which every paper surface shares. This module is the
// wave that passes over it, and the letterbox the page sits in.

import { clamp } from './editor/transforms'
import { drawGridDots, GRID_PAPER, GRID_SPACING, GRID_SPOT_R } from './benDayGrid'
import type { Rect } from './panelGeometry'
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
 * The letterbox around `sheet` on a `w` × `h` viewport, as up to four rectangles that
 * tile it without overlapping — top and bottom the full width, left and right between
 * them. Overlap would matter: a gated dot is alpha-blended, so a corner drawn twice is a
 * darker corner. A band thinner than a pixel is dropped rather than kept alive to draw
 * nothing; on a viewport of the page's own aspect there are none.
 */
export function letterboxBands(w: number, h: number, sheet: Rect): Rect[] {
    const top = sheet.y
    const bottom = h - (sheet.y + sheet.h)
    const left = sheet.x
    const right = w - (sheet.x + sheet.w)
    const bands: Rect[] = []
    if (top >= 1) bands.push({ x: 0, y: 0, w, h: top })
    if (bottom >= 1) bands.push({ x: 0, y: h - bottom, w, h: bottom })
    if (left >= 1) bands.push({ x: 0, y: sheet.y, w: left, h: sheet.h })
    if (right >= 1) bands.push({ x: w - right, y: sheet.y, w: right, h: sheet.h })
    return bands
}

/**
 * The loading screen's grid carrying on in the letterbox around the page sheet — same
 * grid, same light, so the sheet the loading screen washes away reveals the grid it was
 * already showing, lit where it was lit, where the page does not cover it. Only the
 * bands are painted; the sheet stays clear. Returns whether anything was drawn, which
 * is false on a viewport the sheet fills, and the caller's cue to stop the loop.
 */
export function drawMarginGrid(
    ctx: CanvasRenderingContext2D, w: number, h: number, sheet: Rect,
    spot: SpotlightState, accentHex: string,
): boolean {
    ctx.clearRect(0, 0, w, h)
    const bands = letterboxBands(w, h, sheet)
    if (bands.length === 0) return false
    ctx.save()
    ctx.beginPath()
    for (const band of bands) ctx.rect(band.x, band.y, band.w, band.h)
    ctx.clip()
    ctx.fillStyle = GRID_PAPER
    for (const band of bands) ctx.fillRect(band.x, band.y, band.w, band.h)
    // A dot centred just outside a band still reaches into it by up to its radius; the
    // clip trims what crosses back the other way.
    const pad = GRID_SPOT_R
    for (const band of bands) {
        const reach = { x: band.x - pad, y: band.y - pad, w: band.w + 2 * pad, h: band.h + 2 * pad }
        drawGridDots(ctx, reach, spot, accentHex, () => 1)
    }
    ctx.restore()
    return true
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
