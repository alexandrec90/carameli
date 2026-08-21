import { computeClassicLayout } from './classicLayouts'
import { HG, OUTER_M, makePoly } from './panelGeometry'
import type { PanelPoly } from './panelGeometry'
import { PANELS } from './panels'
import type { PanelPage } from './panels'

// ─── Per-page panel layouts ──────────────────────────────────────────────────
// Each page shows its own subset of PANELS on its own grid. computePagePolys
// spreads a page's local polygons into a PANELS-length sparse array, so every
// consumer keeps indexing polygons and panels by the same number and a panel
// that belongs to another page is simply null.

/**
 * Home layout — 4 panels on a 2×2 grid with oblique dividers, matching the
 * classic grid's visual system (same margins, gutters and skew idiom):
 *   Row 1 (44% h): Logo 2 (34%, the smallest panel) | Notepad (66%)
 *   Row 2 (56% h): Push-button phone (46%) | Conversation (54%)
 */
export function computeHomeLayout(w: number, h: number): PanelPoly[] {
    const m = OUTER_M, hg = HG
    const L = m, R = w - m, T = m, B = h - m
    const W = R - L, H = B - T

    // Row divider — tilts down-to-up left-to-right
    const y1L = T + H * 0.44 + 6, y1R = T + H * 0.44 - 6
    const dy1 = (x: number) => y1L + (y1R - y1L) * ((x - L) / W)

    // Row 1 vertical divider — logo | notepad. Wider on narrow viewports so the
    // logo panel never collapses, still the smallest panel either way.
    const split1 = w / h < 0.85 ? 0.42 : 0.34
    const v1xT = L + W * split1 - 9, v1xB = L + W * split1 + 9
    // Row 2 vertical divider — phone | conversation, skewed the other way
    const v2xT = L + W * 0.46 + 8, v2xB = L + W * 0.46 - 8

    const tights: [number, number][][] = [
        // P8 Logo 2            (top-left, smallest)
        [[L + hg, T + hg], [v1xT - hg, T + hg], [v1xB - hg, dy1(v1xB) - hg], [L + hg, dy1(L) - hg]],
        // P9 Notepad           (top-right)
        [[v1xT + hg, T + hg], [R - hg, T + hg], [R - hg, dy1(R) - hg], [v1xB + hg, dy1(v1xB) - hg]],
        // P10 Push-button phone (bottom-left)
        [[L + hg, dy1(L) + hg], [v2xT - hg, dy1(v2xT) + hg], [v2xB - hg, B - hg], [L + hg, B - hg]],
        // P11 Conversation      (bottom-right)
        [[v2xT + hg, dy1(v2xT) + hg], [R - hg, dy1(R) + hg], [R - hg, B - hg], [v2xB + hg, B - hg]],
    ]

    // [top, right, bottom, left] — which edges face the viewport boundary and allow spill
    const spillDirs: [boolean, boolean, boolean, boolean][] = [
        [true, false, false, true],  // P8 top-left corner
        [true, true, false, false],  // P9 top-right corner
        [false, false, true, true],  // P10 bottom-left corner
        [false, true, true, false],  // P11 bottom-right corner
    ]

    return tights.map((t, i) => {
        const [st, sr, sb, sl] = spillDirs[i]
        return makePoly(t as [number, number][], st, sr, sb, sl)
    })
}

/** PANELS-length sparse array: a polygon per panel on the page, null elsewhere. */
export type PagePolys = (PanelPoly | null)[]

export function computePagePolys(w: number, h: number, page: PanelPage): PagePolys {
    const local = page === 'home' ? computeHomeLayout(w, h) : computeClassicLayout(w, h)
    const out: PagePolys = PANELS.map(() => null)
    let j = 0
    for (let i = 0; i < PANELS.length; i++) {
        if (PANELS[i].page === page) out[i] = local[j++] ?? null
    }
    return out
}
