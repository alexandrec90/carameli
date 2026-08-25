import { parseCssColor } from './benDayWash'

// ─── Ben-Day dot renderers: focal patterns ───────────────────────────────────
// The styles built around a focal point or a corner — rays that turn, rings that
// travel outward, a fan that rocks. The styles whose motion is a drifting dot
// field live in patternDrawFields.ts; the style registry and per-panel tuning live
// in panelPatterns.ts.
//
// Every renderer takes `t`, the panel's own clock in seconds. A panel that sits on
// a still frame does so because its clock stopped (panelDotAnim.ts) — never
// because its style has nothing to animate.

// Slowly rotating rays from a focal point + uniform Ben-Day dots on top
export function drawSunburst(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, rayHex: string,
    spacing: number, baseR: number,
    focalX: number, focalY: number, rayCount: number, breathe: number, t: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    const [rr, rg, rb] = parseCssColor(rayHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const fx = focalX * w, fy = focalY * h
    const maxDist = Math.sqrt(w * w + h * h)
    const spin = t * 0.018
    for (let i = 0; i < rayCount; i++) {
        const a1 = (i / rayCount) * Math.PI * 2 + spin
        const a2 = ((i + 0.42) / rayCount) * Math.PI * 2 + spin
        ctx.beginPath()
        ctx.moveTo(fx, fy)
        ctx.lineTo(fx + Math.cos(a1) * maxDist, fy + Math.sin(a1) * maxDist)
        ctx.lineTo(fx + Math.cos(a2) * maxDist, fy + Math.sin(a2) * maxDist)
        ctx.closePath()
        ctx.fillStyle = i % 2 === 0
            ? `rgba(${rr},${rg},${rb},0.18)`
            : `rgba(${rr},${rg},${rb},0.0)`
        ctx.fill()
    }
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
            const wave = (Math.sin((dist / ringPeriod) * Math.PI * 2 - t * 0.9) + 1) / 2
            const radius = baseR * 0.25 + baseR * 1.55 * wave + breathe
            if (radius < 0.3) continue
            ctx.fillStyle = `rgba(${r},${g},${b},${0.15 + wave * 0.65})`
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

// Fan of rays from one corner + radial halftone dots (smaller near corner). The
// fan cannot turn the whole way round — it is pinned to a corner — so it rocks
// about its axis and opens and closes instead, on two rates that do not line up.
export function drawCornerBurst(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, rayHex: string,
    spacing: number, baseR: number,
    cornerX: number, cornerY: number, rayCount: number, breathe: number, t: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    const [rr, rg, rb] = parseCssColor(rayHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const fx = cornerX * w, fy = cornerY * h
    const maxDist = Math.sqrt(w * w + h * h)
    const cAngle = Math.atan2(cornerY > 0.5 ? -1 : 1, cornerX > 0.5 ? -1 : 1)
        + Math.sin(t * 0.09) * 0.14
    const spread = Math.PI * 0.85 * (1 + Math.sin(t * 0.13) * 0.07)
    for (let i = 0; i < rayCount; i++) {
        const a1 = cAngle - spread / 2 + (i / rayCount) * spread
        const a2 = cAngle - spread / 2 + ((i + 0.45) / rayCount) * spread
        ctx.beginPath()
        ctx.moveTo(fx, fy)
        ctx.lineTo(fx + Math.cos(a1) * maxDist, fy + Math.sin(a1) * maxDist)
        ctx.lineTo(fx + Math.cos(a2) * maxDist, fy + Math.sin(a2) * maxDist)
        ctx.closePath()
        ctx.fillStyle = i % 2 === 0
            ? `rgba(${rr},${rg},${rb},0.20)`
            : `rgba(${rr},${rg},${rb},0.0)`
        ctx.fill()
    }
    const maxR = Math.sqrt(w * w + h * h) * 0.7
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
