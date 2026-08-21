import { HG, OUTER_M, makePoly } from './panelGeometry'
import type { PanelPoly } from './panelGeometry'

// ─── Classic (8-panel) layout computations ───────────────────────────────────
// The original full-viewport grid, shown on every route except the home page.

/**
 * Landscape layout (aspect ratio > 1.3):
 *   Row 1 (42% h): Logo (25%) | Switchboard (50%) | Mailman1 (25%)
 *   Row 2 (33% h): Mechanic (30%) | Receptionist (45%) | Rolodex (25%)
 *   Row 3 (25% h): Rotary phone (55%) | Mailman2 (45%)
 * All dividers are obliquely angled.
 */
export function computeLandscapeLayout(w: number, h: number): PanelPoly[] {
    const m = OUTER_M, hg = HG
    const L = m, R = w - m, T = m, B = h - m
    const W = R - L, H = B - T

    // Horizontal dividers — each tilts in a different direction
    const y1L = T + H * 0.42 - 5, y1R = T + H * 0.42 + 5     // row 1/2
    const dy1 = (x: number) => y1L + (y1R - y1L) * ((x - L) / W)

    const y2L = T + H * 0.75 + 4, y2R = T + H * 0.75 - 4     // row 2/3
    const dy2 = (x: number) => y2L + (y2R - y2L) * ((x - L) / W)

    // Row 1 vertical dividers (x at top of row, x at bottom — creates oblique angle)
    const rA_xT = L + W * 0.25 + 8, rA_xB = L + W * 0.25 - 8  // logo | switchboard
    const rB_xT = L + W * 0.75 - 10, rB_xB = L + W * 0.75 + 10 // switchboard | mailman1

    // Row 2 vertical dividers
    const rC_xT = L + W * 0.30 - 7, rC_xB = L + W * 0.30 + 7  // mechanic | receptionist
    const rD_xT = L + W * 0.75 + 8, rD_xB = L + W * 0.75 - 8  // receptionist | rolodex

    // Row 3 vertical divider
    const rE_xT = L + W * 0.55 + 6, rE_xB = L + W * 0.55 - 6  // rotary phone | mailman2

    const tights: [number, number][][] = [
        // P0 Logo        (top-left)
        [[L + hg, T + hg], [rA_xT - hg, T + hg], [rA_xB - hg, dy1(rA_xB) - hg], [L + hg, dy1(L) - hg]],
        // P1 Switchboard (top-center)
        [[rA_xT + hg, T + hg], [rB_xT - hg, T + hg], [rB_xB - hg, dy1(rB_xB) - hg], [rA_xB + hg, dy1(rA_xB) - hg]],
        // P2 Mailman1    (top-right)
        [[rB_xT + hg, T + hg], [R - hg, T + hg], [R - hg, dy1(R) - hg], [rB_xB + hg, dy1(rB_xB) - hg]],
        // P3 Mechanic    (mid-left)
        [[L + hg, dy1(L) + hg], [rC_xT - hg, dy1(rC_xT) + hg], [rC_xB - hg, dy2(rC_xB) - hg], [L + hg, dy2(L) - hg]],
        // P4 Receptionist(mid-center)
        [[rC_xT + hg, dy1(rC_xT) + hg], [rD_xT - hg, dy1(rD_xT) + hg], [rD_xB - hg, dy2(rD_xB) - hg], [rC_xB + hg, dy2(rC_xB) - hg]],
        // P5 Rolodex     (mid-right)
        [[rD_xT + hg, dy1(rD_xT) + hg], [R - hg, dy1(R) + hg], [R - hg, dy2(R) - hg], [rD_xB + hg, dy2(rD_xB) - hg]],
        // P6 Rotary phone(bot-left)
        [[L + hg, dy2(L) + hg], [rE_xT - hg, dy2(rE_xT) + hg], [rE_xB - hg, B - hg], [L + hg, B - hg]],
        // P7 Mailman2    (bot-right)
        [[rE_xT + hg, dy2(rE_xT) + hg], [R - hg, dy2(R) + hg], [R - hg, B - hg], [rE_xB + hg, B - hg]],
    ]

    // [top, right, bottom, left] — which edges face the viewport boundary and allow spill
    const spillDirs: [boolean, boolean, boolean, boolean][] = [
        [true, false, false, true],   // P0 top-left corner
        [true, false, false, false],  // P1 top edge only
        [true, true, false, false],  // P2 top-right corner
        [false, false, false, true],   // P3 left edge only
        [false, false, false, false],  // P4 interior — no spill
        [false, true, false, false],  // P5 right edge only
        [false, false, true, true],   // P6 bottom-left corner
        [false, true, true, false],  // P7 bottom-right corner
    ]

    return tights.map((t, i) => {
        const [st, sr, sb, sl] = spillDirs[i]
        return makePoly(t as [number, number][], st, sr, sb, sl)
    })
}

/**
 * Portrait layout (aspect ratio < 0.75):
 *   4 rows × 2 columns, each divider alternates skew direction.
 */
export function computePortraitLayout(w: number, h: number): PanelPoly[] {
    const m = OUTER_M, hg = HG
    const L = m, R = w - m, T = m, B = h - m
    const W = R - L, H = B - T

    const y1L = T + H * 0.22 + 3, y1R = T + H * 0.22 - 3
    const dy1 = (x: number) => y1L + (y1R - y1L) * ((x - L) / W)

    const y2L = T + H * 0.50 - 4, y2R = T + H * 0.50 + 4
    const dy2 = (x: number) => y2L + (y2R - y2L) * ((x - L) / W)

    const y3L = T + H * 0.75 + 3, y3R = T + H * 0.75 - 3
    const dy3 = (x: number) => y3L + (y3R - y3L) * ((x - L) / W)

    const v1xT = L + W * 0.45 - 6, v1xB = L + W * 0.45 + 6  // row 1
    const v2xT = L + W * 0.55 + 8, v2xB = L + W * 0.55 - 8  // row 2
    const v3xT = L + W * 0.40 - 5, v3xB = L + W * 0.40 + 5  // row 3
    const v4xT = L + W * 0.60 + 7, v4xB = L + W * 0.60 - 7  // row 4

    const tights: [number, number][][] = [
        // P0 Logo        (row1-left)
        [[L + hg, T + hg], [v1xT - hg, T + hg], [v1xB - hg, dy1(v1xB) - hg], [L + hg, dy1(L) - hg]],
        // P1 Switchboard (row1-right)
        [[v1xT + hg, T + hg], [R - hg, T + hg], [R - hg, dy1(R) - hg], [v1xB + hg, dy1(v1xB) - hg]],
        // P2 Mailman1    (row2-left)
        [[L + hg, dy1(L) + hg], [v2xT - hg, dy1(v2xT) + hg], [v2xB - hg, dy2(v2xB) - hg], [L + hg, dy2(L) - hg]],
        // P3 Mechanic    (row2-right)
        [[v2xT + hg, dy1(v2xT) + hg], [R - hg, dy1(R) + hg], [R - hg, dy2(R) - hg], [v2xB + hg, dy2(v2xB) - hg]],
        // P4 Receptionist(row3-left)
        [[L + hg, dy2(L) + hg], [v3xT - hg, dy2(v3xT) + hg], [v3xB - hg, dy3(v3xB) - hg], [L + hg, dy3(L) - hg]],
        // P5 Rolodex     (row3-right)
        [[v3xT + hg, dy2(v3xT) + hg], [R - hg, dy2(R) + hg], [R - hg, dy3(R) - hg], [v3xB + hg, dy3(v3xB) - hg]],
        // P6 Rotary phone(row4-left)
        [[L + hg, dy3(L) + hg], [v4xT - hg, dy3(v4xT) + hg], [v4xB - hg, B - hg], [L + hg, B - hg]],
        // P7 Mailman2    (row4-right)
        [[v4xT + hg, dy3(v4xT) + hg], [R - hg, dy3(R) + hg], [R - hg, B - hg], [v4xB + hg, B - hg]],
    ]

    const spillDirs: [boolean, boolean, boolean, boolean][] = [
        [true, false, false, true],  // P0
        [true, true, false, false], // P1
        [false, false, false, true],  // P2
        [false, true, false, false], // P3
        [false, false, false, true],  // P4
        [false, true, false, false], // P5
        [false, false, true, true],  // P6
        [false, true, true, false], // P7
    ]

    return tights.map((t, i) => {
        const [st, sr, sb, sl] = spillDirs[i]
        return makePoly(t as [number, number][], st, sr, sb, sl)
    })
}

/**
 * Square layout (aspect ratio 0.75–1.3):
 *   Row 1 (38% h): Logo (30%) | Switchboard (42%) | Mailman1 (28%)
 *   Row 2 (34% h): Mechanic (48%) | Receptionist (52%)
 *   Row 3 (28% h): Rolodex (28%) | Rotary phone (37%) | Mailman2 (35%)
 */
export function computeSquareLayout(w: number, h: number): PanelPoly[] {
    const m = OUTER_M, hg = HG
    const L = m, R = w - m, T = m, B = h - m
    const W = R - L, H = B - T

    const y1L = T + H * 0.38 - 4, y1R = T + H * 0.38 + 4
    const dy1 = (x: number) => y1L + (y1R - y1L) * ((x - L) / W)

    const y2L = T + H * 0.72 + 5, y2R = T + H * 0.72 - 5
    const dy2 = (x: number) => y2L + (y2R - y2L) * ((x - L) / W)

    // Row 1
    const rA_xT = L + W * 0.30 + 7, rA_xB = L + W * 0.30 - 7
    const rB_xT = L + W * 0.72 - 9, rB_xB = L + W * 0.72 + 9
    // Row 2 (2 panels)
    const rC_xT = L + W * 0.48 - 6, rC_xB = L + W * 0.48 + 6
    // Row 3
    const rD_xT = L + W * 0.28 + 5, rD_xB = L + W * 0.28 - 5
    const rE_xT = L + W * 0.65 - 7, rE_xB = L + W * 0.65 + 7

    const tights: [number, number][][] = [
        // P0 Logo         (row1-left)
        [[L + hg, T + hg], [rA_xT - hg, T + hg], [rA_xB - hg, dy1(rA_xB) - hg], [L + hg, dy1(L) - hg]],
        // P1 Switchboard  (row1-center)
        [[rA_xT + hg, T + hg], [rB_xT - hg, T + hg], [rB_xB - hg, dy1(rB_xB) - hg], [rA_xB + hg, dy1(rA_xB) - hg]],
        // P2 Mailman1     (row1-right)
        [[rB_xT + hg, T + hg], [R - hg, T + hg], [R - hg, dy1(R) - hg], [rB_xB + hg, dy1(rB_xB) - hg]],
        // P3 Mechanic     (row2-left)
        [[L + hg, dy1(L) + hg], [rC_xT - hg, dy1(rC_xT) + hg], [rC_xB - hg, dy2(rC_xB) - hg], [L + hg, dy2(L) - hg]],
        // P4 Receptionist (row2-right)
        [[rC_xT + hg, dy1(rC_xT) + hg], [R - hg, dy1(R) + hg], [R - hg, dy2(R) - hg], [rC_xB + hg, dy2(rC_xB) - hg]],
        // P5 Rolodex      (row3-left)
        [[L + hg, dy2(L) + hg], [rD_xT - hg, dy2(rD_xT) + hg], [rD_xB - hg, B - hg], [L + hg, B - hg]],
        // P6 Rotary phone (row3-center)
        [[rD_xT + hg, dy2(rD_xT) + hg], [rE_xT - hg, dy2(rE_xT) + hg], [rE_xB - hg, B - hg], [rD_xB + hg, B - hg]],
        // P7 Mailman2     (row3-right)
        [[rE_xT + hg, dy2(rE_xT) + hg], [R - hg, dy2(R) + hg], [R - hg, B - hg], [rE_xB + hg, B - hg]],
    ]

    const spillDirs: [boolean, boolean, boolean, boolean][] = [
        [true, false, false, true],  // P0
        [true, false, false, false], // P1
        [true, true, false, false], // P2
        [false, false, false, true],  // P3
        [false, true, false, false], // P4
        [false, false, true, true],  // P5
        [false, false, true, false], // P6
        [false, true, true, false], // P7
    ]

    return tights.map((t, i) => {
        const [st, sr, sb, sl] = spillDirs[i]
        return makePoly(t as [number, number][], st, sr, sb, sl)
    })
}

export function computeClassicLayout(w: number, h: number): PanelPoly[] {
    const ar = w / h
    if (ar < 0.85) return computePortraitLayout(w, h)    // < ~765 px wide on 900 px tall
    if (ar > 1.25) return computeLandscapeLayout(w, h)   // > ~1125 px wide on 900 px tall
    return computeSquareLayout(w, h)
}
