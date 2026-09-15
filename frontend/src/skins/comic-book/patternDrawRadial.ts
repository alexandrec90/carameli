import { parseCssColor } from './benDayWash'
import { SPIN_RATE, WAVE_RATE, travellingWave } from './patternWave'

// ─── Ben-Day dot renderers: focal patterns ───────────────────────────────────
// The styles built around a focal point or a corner — rays that turn, rings that
// travel outward. The styles whose motion is a drifting dot field live in
// patternDrawFields.ts; the style registry and per-panel tuning live in
// panelPatterns.ts, and the shared motion terms in patternWave.ts.
//
// Every renderer takes `t`, the panel's own clock in seconds. A panel that sits on
// a still frame does so because its clock stopped (panelDotAnim.ts) — never
// because its style has nothing to animate.

/**
 * A fan of rays about (`fx`, `fy`), turning at the shared spin rate.
 *
 * The wedges cover the **whole circle** even when the focus sits in a corner and
 * three quarters of them fall outside the panel. A fan spanning only the visible
 * quarter cannot turn — rotate it and it swings off the panel altogether — and
 * turning is the whole motion, so the fan is a wheel and the panel is a window
 * onto part of it.
 *
 * Only the inked wedges are drawn, hence the step of two: the gaps between them
 * are the background showing through, and painting them at zero alpha was work
 * with no pixels to show for it.
 */
function drawRayFan(
    ctx: CanvasRenderingContext2D, fx: number, fy: number, reach: number,
    wedges: number, rayHex: string, alpha: number, t: number,
) {
    const [rr, rg, rb] = parseCssColor(rayHex)
    const spin = t * SPIN_RATE
    ctx.fillStyle = `rgba(${rr},${rg},${rb},${alpha})`
    for (let i = 0; i < wedges; i += 2) {
        const a1 = (i / wedges) * Math.PI * 2 + spin
        const a2 = ((i + 0.42) / wedges) * Math.PI * 2 + spin
        ctx.beginPath()
        ctx.moveTo(fx, fy)
        ctx.lineTo(fx + Math.cos(a1) * reach, fy + Math.sin(a1) * reach)
        ctx.lineTo(fx + Math.cos(a2) * reach, fy + Math.sin(a2) * reach)
        ctx.closePath()
        ctx.fill()
    }
}

// Slowly rotating rays from a focal point + uniform Ben-Day dots on top
export function drawSunburst(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, rayHex: string,
    spacing: number, baseR: number,
    focalX: number, focalY: number, rayCount: number, breathe: number, t: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const maxDist = Math.sqrt(w * w + h * h)
    drawRayFan(ctx, focalX * w, focalY * h, maxDist, rayCount, rayHex, 0.18, t)
    ctx.fillStyle = `rgba(${r},${g},${b},0.30)`
    for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < h; y += spacing) {
            ctx.beginPath()
            ctx.arc(x, y, baseR + breathe, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

// Dot size pulses in concentric ring waves radiating outward from a focal point
export function drawConcentricRings(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, spacing: number, baseR: number,
    focalX: number, focalY: number, breathe: number, t: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const fx = focalX * w, fy = focalY * h
    const ringPeriod = spacing * 3.8
    for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < h; y += spacing) {
            const dx = x - fx, dy = y - fy
            const dist = Math.sqrt(dx * dx + dy * dy)
            const wave = travellingWave(dist, ringPeriod, t, WAVE_RATE)
            const radius = baseR * 0.25 + baseR * 1.55 * wave + breathe
            if (radius < 0.3) continue
            ctx.fillStyle = `rgba(${r},${g},${b},${0.15 + wave * 0.65})`
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

/**
 * Rays from one corner + radial halftone dots, smaller near the corner.
 *
 * The fan turns exactly as sunburst's does — it is the same wheel, seen from a
 * corner instead of the middle. `rayCount` therefore keeps its sunburst meaning of
 * wedges *across the panel*, which from a corner is a quarter of the circle, and
 * the wheel is built with four times that many so the count a panel is tuned to is
 * the count it shows. Until 2026-08-25 this rocked about a fixed axis and opened
 * and closed instead, which read as a twitch rather than a rotation.
 */
export function drawCornerBurst(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, rayHex: string,
    spacing: number, baseR: number,
    cornerX: number, cornerY: number, rayCount: number, breathe: number, t: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const fx = cornerX * w, fy = cornerY * h
    const maxDist = Math.sqrt(w * w + h * h)
    drawRayFan(ctx, fx, fy, maxDist, rayCount * 4, rayHex, 0.20, t)
    const maxR = maxDist * 0.7
    for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < h; y += spacing) {
            const dx = x - fx, dy = y - fy
            const t01 = Math.min(1, Math.sqrt(dx * dx + dy * dy) / maxR)
            const radius = baseR * 0.2 + baseR * 1.5 * t01 + breathe
            if (radius < 0.3) continue
            ctx.fillStyle = `rgba(${r},${g},${b},${0.20 + t01 * 0.45})`
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}
