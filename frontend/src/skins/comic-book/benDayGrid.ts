// The Ben-Day grid — the printed dot field every paper surface in the skin shows.
//
// One grid of ink dots at a fixed pitch over the *viewport*, drawn by the skin's
// loading screen (`skins/context.tsx`, up while the chunk loads), the page's loading
// sheet (`LoadingOverlay.tsx`), the letterbox around the page (`MarginGrid.tsx`) and
// the page-transition wash (`benDayWash.ts`). The cells are anchored to the viewport
// rather than to the region a caller asks for, so every surface prints the same dot in
// the same place and each handoff between them is seamless.
//
// **The ink is flat; the light changes the shape and nothing else.** Every dot is the
// same opaque colour wherever it is, so the field is there to read on a resting page.
// The pool of light that follows the cursor (`spotlight.ts`) swells the dots inside it
// toward `GRID_SPOT_R` — that is the whole of the effect, which is what makes it read
// as a spotlight travelling over a print rather than as the print switching on under
// the cursor. The route accent gives the ink its hue, darkened as far as it takes to
// clear `GRID_MIN_CONTRAST` on the paper, because a pale accent printed flat is the
// invisible grid this replaces.
//
// This module is imported by the loading screen that renders *before* the comic-book
// chunk, so whatever it imports is in the eager bundle every visitor downloads whatever
// skin they land on (`bundlePolicy.ts`). Keep it to the grid — no stylesheet, no page
// geometry — with `spotlight.ts` its only skin import and **no React**: being shared
// between the entry and a lazy chunk is what decides how Rollup splits it, and pulling
// React into that shared set moved 10 KB of `jsx-runtime` into a chunk of its own and
// added an import of it to all 38 lazy chunks. `runBenDayGrid` is an effect body, not
// a hook, for that reason; its two callers each wrap it in four lines of their own.

import { pageSpotlight, spotlightAt } from './spotlight'
import type { SpotlightState } from './spotlight'
import type { Rect } from './panelGeometry'

/** px between dot centres, shared by every surface that draws the grid. */
export const GRID_SPACING = 20

/** The paper the grid prints on. */
export const GRID_PAPER = '#FAFAF2'

/** Radius in px of a dot the light does not reach. */
export const GRID_REST_R = 2
/** Radius in px of the dot at the centre of the light. */
export const GRID_SPOT_R = 6

/**
 * The ink is opaque. A dot is either printed or it is not: the resting field and the
 * lit pool are the same colour, and only the wash fades the grid (by its `gate`, where
 * the paper sheet under it has not merged solid yet).
 */
export const GRID_ALPHA = 1

/**
 * The contrast a grid dot keeps against {@link GRID_PAPER}.
 *
 * Of the four route accents, `#0057B8` (6.55:1) and `#E8003D` (4.45:1) already clear it
 * and print as themselves. `#00AEEF` at 2.41:1 is nudged to 3.01. The home page's
 * `#FFE033` is the case this exists for: **1.25:1** on near-white paper, which is the
 * grid you could not see until the pointer reached it, and prints as `165,145,33`.
 *
 * 3:1 is the large-object bar from WCAG, which is the right one — these are 4–12 px
 * discs, not text.
 */
export const GRID_MIN_CONTRAST = 3

export function parseCssColor(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return [r, g, b]
}

function toLinear(channel: number): number {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance, 0 (black) to 1 (white), of an 8-bit sRGB triple. */
export function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/** WCAG contrast ratio, 1..21, between two relative luminances in either order. */
export function contrastRatio(a: number, b: number): number {
    return a >= b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05)
}

const PAPER_LUMINANCE = relativeLuminance(parseCssColor(GRID_PAPER))

/**
 * `rgb` darkened just far enough to clear {@link GRID_MIN_CONTRAST} on the paper — the
 * same hue, its channels scaled toward black together, so a route keeps its accent
 * rather than being handed a different colour. A colour that already clears the bar is
 * returned as it is.
 */
export function inkOnPaper(rgb: readonly [number, number, number]): [number, number, number] {
    const clears = (c: readonly [number, number, number]) =>
        contrastRatio(relativeLuminance(c), PAPER_LUMINANCE) >= GRID_MIN_CONTRAST
    const scaled = (k: number): [number, number, number] =>
        [Math.floor(rgb[0] * k), Math.floor(rgb[1] * k), Math.floor(rgb[2] * k)]
    if (clears(rgb)) return [rgb[0], rgb[1], rgb[2]]
    // Luminance falls with the scale, so the darkest scaling (black) always clears the
    // bar and bisection finds the lightest one that does: `lo` clears it, `hi` does not.
    // Twenty steps land inside a thousandth of a channel, well under the floor below.
    let lo = 0
    let hi = 1
    for (let i = 0; i < 20; i += 1) {
        const mid = (lo + hi) / 2
        if (clears(scaled(mid))) lo = mid
        else hi = mid
    }
    return scaled(lo)
}

const inkCache = new Map<string, [number, number, number]>()

/**
 * The ink a route's accent prints as: {@link inkOnPaper} of it, memoised, because every
 * frame of every surface asks for it and the search behind it is a bisection.
 */
export function gridInk(accentHex: string): [number, number, number] {
    let ink = inkCache.get(accentHex)
    if (ink === undefined) {
        ink = inkOnPaper(parseCssColor(accentHex))
        inkCache.set(accentHex, ink)
    }
    return ink
}

/**
 * Radius of a grid dot lit `lit` (0..1) by the spotlight: the resting radius at 0, the
 * full one at 1, mixed rather than offset so the ends come out exact — a resting dot is
 * the resting dot, bit for bit. Size is the only thing the light changes.
 */
export function gridDotRadius(lit: number): number {
    return GRID_REST_R * (1 - lit) + GRID_SPOT_R * lit
}

/** The first grid centre at or after `from`: the grid's dots sit at S/2 + k·S, k ≥ 0. */
function firstCentre(from: number): number {
    return GRID_SPACING / 2
        + GRID_SPACING * Math.max(0, Math.ceil((from - GRID_SPACING / 2) / GRID_SPACING))
}

/**
 * Grid dots over the paper, for the cells of the *viewport's* grid whose centres fall in
 * `region` — the grid never moves with the region, which is what keeps every surface
 * drawing the same dot in the same place. `gate` (0..1 per diagonal distance) fades the
 * grid out where the wash's sheet is not fully merged, so it never floats over raw page;
 * every other surface passes 1 everywhere. One ink means one fill: the whole field goes
 * down as a single path however large the viewport, and only the gated dots — the wash's
 * moving edge — carry an alpha of their own.
 */
export function drawGridDots(
    ctx: CanvasRenderingContext2D, region: Rect,
    spot: SpotlightState, accentHex: string, gate: (diag: number) => number,
) {
    const rgb = gridInk(accentHex).join(',')
    const right = region.x + region.w
    const bottom = region.y + region.h
    // [x, y, radius, gate] of the dots the gate is fading.
    const faded: Array<[number, number, number, number]> = []
    ctx.fillStyle = `rgba(${rgb},${GRID_ALPHA})`
    ctx.beginPath()
    for (let x = firstCentre(region.x); x < right; x += GRID_SPACING) {
        for (let y = firstCentre(region.y); y < bottom; y += GRID_SPACING) {
            const gt = gate(x + y)
            if (gt <= 0) continue
            const radius = gridDotRadius(spotlightAt(spot, x, y))
            if (gt >= 1) {
                ctx.moveTo(x + radius, y)
                ctx.arc(x, y, radius, 0, Math.PI * 2)
                continue
            }
            faded.push([x, y, radius, gt])
        }
    }
    ctx.fill()
    for (const [x, y, radius, gt] of faded) {
        ctx.fillStyle = `rgba(${rgb},${(GRID_ALPHA * gt).toFixed(2)})`
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
    }
}

/** Loading-screen background: solid paper + the full lit grid. */
export function drawLoadingGrid(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    spot: SpotlightState, accentHex: string,
) {
    ctx.fillStyle = GRID_PAPER
    ctx.fillRect(0, 0, w, h)
    drawGridDots(ctx, { x: 0, y: 0, w, h }, spot, accentHex, () => 1)
}

/**
 * Paints a full-viewport loading grid on `canvas` and keeps it painted, returning the
 * teardown. Both loading screens run it — the one the skin's chunk is loading behind and
 * the one the page's pictures are loading behind — so the chunk arriving changes the
 * legend on top of the grid and nothing underneath it.
 *
 * Repainted only on a frame the light actually moved, and after a resize, which leaves
 * the bitmap blank whether or not it did. It does not consult `prefers-reduced-motion`:
 * the grid moves only as the hand does, and a light that stopped following the pointer
 * would read as the page having hung rather than as a preference honoured.
 */
export function runBenDayGrid(canvas: HTMLCanvasElement, accent: string): () => void {
    const ctx = canvas.getContext('2d')
    if (!ctx) return () => {}
    let shown: SpotlightState | null = null
    const resize = () => {
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight
        shown = null
    }
    resize()
    window.addEventListener('resize', resize)
    const spotlight = pageSpotlight()
    const release = spotlight.acquire()
    let raf = 0
    const loop = (now: number) => {
        const spot = spotlight.sample(now)
        if (spot !== shown) {
            shown = spot
            drawLoadingGrid(ctx, canvas.width, canvas.height, spot, accent)
        }
        raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
        window.removeEventListener('resize', resize)
        cancelAnimationFrame(raf)
        release()
    }
}
