import { parseCssColor } from './benDayWash'

// ─── Ben-Day dot renderers ───────────────────────────────────────────────────
// One canvas-painting function per pattern style. Pure drawing: each fills the
// whole w×h with its background and dots and knows nothing about panels — the
// style registry and per-panel tuning live in panelPatterns.ts.

// Dots grow small→large along a directional gradient (halftone fade effect)
export function drawHalftoneGradient(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, spacing: number, baseR: number,
    angleDeg: number, breathe: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const rad = angleDeg * Math.PI / 180
    const cc = Math.cos(rad), ss = Math.sin(rad)
    for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < h; y += spacing) {
            const nx = x / w - 0.5, ny = y / h - 0.5
            const proj = nx * cc + ny * ss
            const t01 = Math.max(0, Math.min(1, proj * 0.95 + 0.5))
            const radius = baseR * 0.2 + baseR * 1.7 * t01 + breathe
            if (radius < 0.4) continue
            ctx.fillStyle = `rgba(${r},${g},${b},${0.35 + t01 * 0.55})`
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fill()
        }
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

// Two bold background zones with different dot colors and densities
export function drawColorBlock(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex1: string, bg1: string, dotHex2: string, bg2: string,
    spacing: number, baseR: number, splitY: number, breathe: number,
) {
    const [r1, g1, b1] = parseCssColor(dotHex1)
    const [r2, g2, b2] = parseCssColor(dotHex2)
    const sp = h * splitY
    ctx.fillStyle = bg1
    ctx.fillRect(0, 0, w, sp)
    ctx.fillStyle = bg2
    ctx.fillRect(0, sp, w, h - sp)
    for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < sp; y += spacing) {
            ctx.fillStyle = `rgba(${r1},${g1},${b1},0.72)`
            ctx.beginPath()
            ctx.arc(x, y, baseR * 1.25 + breathe, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    for (let x = spacing * 0.8; x < w; x += spacing * 1.6) {
        for (let y = sp + spacing * 0.8; y < h; y += spacing * 1.6) {
            ctx.fillStyle = `rgba(${r2},${g2},${b2},0.45)`
            ctx.beginPath()
            ctx.arc(x, y, baseR * 0.65 + breathe * 0.4, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

// Large dense dots at edges fade to clear center — ink vignette
export function drawVignette(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, spacing: number, baseR: number, breathe: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const cx = w / 2, cy = h / 2
    const maxDist = Math.sqrt(cx * cx + cy * cy)
    for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < h; y += spacing) {
            const dx = x - cx, dy = y - cy
            const t01 = Math.min(1, Math.sqrt(dx * dx + dy * dy) / maxDist)
            const radius = baseR * 0.1 + baseR * 2.1 * t01 * t01 + breathe
            if (radius < 0.4) continue
            ctx.fillStyle = `rgba(${r},${g},${b},${0.08 + t01 * 0.75})`
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

// Dots grow from tiny near focal point to large far away — radial halftone
export function drawRadialDots(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, spacing: number, baseR: number,
    focalX: number, focalY: number, breathe: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const fx = focalX * w, fy = focalY * h
    const maxDist = Math.sqrt(w * w + h * h) * 0.65
    for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < h; y += spacing) {
            const dx = x - fx, dy = y - fy
            const t01 = Math.min(1, Math.sqrt(dx * dx + dy * dy) / maxDist)
            const radius = baseR * 0.15 + baseR * 1.7 * t01 + breathe
            if (radius < 0.3) continue
            ctx.fillStyle = `rgba(${r},${g},${b},${0.12 + t01 * 0.68})`
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

// Alternating dense / sparse bands at a diagonal angle
export function drawDiagonalStripes(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, spacing: number, baseR: number,
    angleDeg: number, breathe: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const rad = angleDeg * Math.PI / 180
    const period = spacing * 3.2
    for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < h; y += spacing) {
            const proj = x * Math.cos(rad) + y * Math.sin(rad)
            const stripe = ((proj % period) + period) % period
            const inDense = stripe < period * 0.55
            const radius = inDense
                ? baseR * 1.3 + breathe
                : baseR * 0.4 + breathe * 0.3
            if (radius < 0.3) continue
            ctx.fillStyle = `rgba(${r},${g},${b},${inDense ? 0.68 : 0.2})`
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
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

// Fan of rays from one corner + radial halftone dots (smaller near corner)
export function drawCornerBurst(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    dotHex: string, bgHex: string, rayHex: string,
    spacing: number, baseR: number,
    cornerX: number, cornerY: number, rayCount: number, breathe: number,
) {
    const [r, g, b] = parseCssColor(dotHex)
    const [rr, rg, rb] = parseCssColor(rayHex)
    ctx.fillStyle = bgHex
    ctx.fillRect(0, 0, w, h)
    const fx = cornerX * w, fy = cornerY * h
    const maxDist = Math.sqrt(w * w + h * h)
    const cAngle = Math.atan2(cornerY > 0.5 ? -1 : 1, cornerX > 0.5 ? -1 : 1)
    const spread = Math.PI * 0.85
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
