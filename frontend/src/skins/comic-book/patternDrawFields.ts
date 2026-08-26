import { parseCssColor } from './benDayWash'
import { SWEEP_RATE, WAVE_RATE, travellingWave } from './patternWave'

// ─── Ben-Day dot renderers: dot fields ───────────────────────────────────────
// One canvas-painting function per pattern style whose motion is carried by the
// *field* the dots are sized from — the gradient axis, the zone boundary, the
// stripe phase. The styles built around a focal point live in patternDrawRadial.ts;
// the style registry and per-panel tuning live in panelPatterns.ts.
//
// Every renderer takes `t`, the panel's own clock in seconds, and every one moves
// with it. A panel that sits on a still frame does so because its clock stopped
// (panelDotAnim.ts) — never because its style has nothing to animate.
//
// **Where the motion actually lives is a wave, not a drift** (patternWave.ts). A
// slow drift of a whole field is the version that failed review: at a rate low
// enough to read as calm it is not visible at all, and at a rate high enough to be
// visible the entire picture slides. A wave passing *through* a still field is
// legible at a slow pace, because the eye tracks its crest rather than the field.
// Each style keeps a slow field drift on top, so the panel is never quite where it
// was a minute ago either.

// Dots grow small to large along a directional gradient (halftone fade effect).
// The dense end drifts back and forth along that axis, and a wave runs down the
// same axis, so the fade sweeps and swells at once.
export function drawHalftoneGradient(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, spacing: number, baseR: number,
    angleDeg: number, breathe: number, t: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const rad = angleDeg * Math.PI / 180
    const cc = Math.cos(rad), ss = Math.sin(rad)
    const drift = Math.sin(t * 0.11) * 0.30
    for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < h; y += spacing) {
            const nx = x / w - 0.5, ny = y / h - 0.5
            const proj = nx * cc + ny * ss
            const t01 = Math.max(0, Math.min(1, proj * 0.95 + 0.5 + drift))
            const wave = travellingWave(
                (x - w / 2) * cc + (y - h / 2) * ss, spacing * 4, t, SWEEP_RATE)
            const radius = baseR * 0.32 + baseR * 1.25 * t01
                + baseR * 0.42 * wave + breathe
            if (radius < 0.4) continue
            ctx.fillStyle =
                `rgba(${r},${g},${b},${(0.30 + t01 * 0.50) * (0.55 + wave * 0.45)})`
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

/**
 * Where the two color-block zones meet at `x`, as a fraction of panel height: a
 * swell travelling along the boundary plus a slower tide lifting the whole line.
 * Shared by the fills and the dots so the dot fields ride the same edge the paint
 * does — computing it twice is what would let them drift apart.
 */
function blockSplitAt(x: number, w: number, splitY: number, t: number): number {
    const along = (x / Math.max(1, w)) * Math.PI * 2
    return splitY
        + Math.sin(along + t * 0.5) * 0.03
        + Math.sin(t * 0.19) * 0.035
}

// Two bold background zones with different dot colors and densities
export function drawColorBlock(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex1: string, bg1: string, dotHex2: string, bg2: string,
    spacing: number, baseR: number, splitY: number, breathe: number, t: number,
) {
    const [r1, g1, b1] = parseCssColor(dotHex1)
    const [r2, g2, b2] = parseCssColor(dotHex2)
    ctx.fillStyle = bg1
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = bg2
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, blockSplitAt(x, w, splitY, t) * h)
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
    for (let x = spacing / 2; x < w; x += spacing) {
        const sp = blockSplitAt(x, w, splitY, t) * h
        for (let y = spacing / 2; y < sp; y += spacing) {
            ctx.fillStyle = `rgba(${r1},${g1},${b1},0.72)`
            ctx.beginPath()
            ctx.arc(x, y, baseR * 1.25 + breathe, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    for (let x = spacing * 0.8; x < w; x += spacing * 1.6) {
        const sp = blockSplitAt(x, w, splitY, t) * h
        for (let y = sp + spacing * 0.8; y < h; y += spacing * 1.6) {
            ctx.fillStyle = `rgba(${r2},${g2},${b2},0.45)`
            ctx.beginPath()
            ctx.arc(x, y, baseR * 0.65 + breathe * 0.4, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

// Large dense dots at edges fade to clear center — ink vignette. The clear middle
// widens and closes again like an aperture, and rings run out through the dark
// edge so the frame is never a still band of ink.
export function drawVignette(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, spacing: number, baseR: number,
    breathe: number, t: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const cx = w / 2, cy = h / 2
    const maxDist = Math.sqrt(cx * cx + cy * cy) * (1 + Math.sin(t * 0.13) * 0.20)
    for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < h; y += spacing) {
            const dx = x - cx, dy = y - cy
            const dist = Math.sqrt(dx * dx + dy * dy)
            const t01 = Math.min(1, dist / maxDist)
            const wave = travellingWave(dist, spacing * 3.8, t, WAVE_RATE)
            const radius = baseR * 0.30 + baseR * 1.60 * t01 * t01
                + baseR * 0.35 * wave + breathe
            if (radius < 0.4) continue
            ctx.fillStyle =
                `rgba(${r},${g},${b},${(0.10 + t01 * 0.70) * (0.60 + wave * 0.40)})`
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

// Dots grow from tiny near focal point to large far away — radial halftone. The
// focal point wanders a slow open loop (the two axes are at different rates, so it
// never quite retraces itself) while ring waves run outward from wherever it is.
export function drawRadialDots(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, spacing: number, baseR: number,
    focalX: number, focalY: number, breathe: number, t: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const fx = (focalX + Math.cos(t * 0.14) * 0.13) * w
    const fy = (focalY + Math.sin(t * 0.108) * 0.11) * h
    const maxDist = Math.sqrt(w * w + h * h) * 0.65
    for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < h; y += spacing) {
            const dx = x - fx, dy = y - fy
            const dist = Math.sqrt(dx * dx + dy * dy)
            const t01 = Math.min(1, dist / maxDist)
            const wave = travellingWave(dist, spacing * 3.8, t, WAVE_RATE)
            const radius = baseR * 0.30 + baseR * 1.35 * t01
                + baseR * 0.40 * wave + breathe
            if (radius < 0.3) continue
            ctx.fillStyle =
                `rgba(${r},${g},${b},${(0.15 + t01 * 0.60) * (0.55 + wave * 0.45)})`
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

/**
 * Bands running at a diagonal angle, sweeping sideways across the panel: dots
 * swell and ink up as a band arrives, then shrink and fade as it leaves.
 *
 * Until 2026-08-25 the bands had hard edges and slid as a block, which read as
 * fast and mechanical however low the rate went — a dot at a boundary snapped
 * between two sizes every pass. Concentric rings is the pattern this is now built
 * from: same wave, straight instead of circular, at half the rate because a
 * straight sweep reads faster than an expanding ring (patternWave.ts).
 */
export function drawDiagonalStripes(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, spacing: number, baseR: number,
    angleDeg: number, breathe: number, t: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const rad = angleDeg * Math.PI / 180
    const cc = Math.cos(rad), ss = Math.sin(rad)
    const period = spacing * 3.6
    for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < h; y += spacing) {
            const wave = travellingWave(x * cc + y * ss, period, t, SWEEP_RATE)
            const radius = baseR * 0.40 + baseR * 1.20 * wave + breathe
            if (radius < 0.3) continue
            ctx.fillStyle = `rgba(${r},${g},${b},${0.18 + wave * 0.60})`
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}
