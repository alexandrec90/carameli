import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { LayoutProps } from '../types'
import { isBubbleRevealed } from './bubbleTube'
import BubbleTubes from './BubbleTubes'
import PanelBubbles from './PanelBubbles'
import PanelImages from './PanelImages'
import { PANELS } from './panels'
import { computeLayout, type PanelPoly } from './panelLayout'
import { PANEL_IMG_TRANSFORMS, PANEL_BUBBLE_TRANSFORMS } from './editor/layoutConfig'
import { toClipPath } from './editor/transforms'
import { shouldRevealImg, useEditorMode } from './editor/useEditorMode'
import {
    drawLoadingRipple, drawWash, parseCssColor, washPhaseAt,
    WASH_COVER_MS, WASH_HOLD_MS,
} from './benDayWash'
import './comic-book.css'
import './bubbles.css'

// ─── Ben-Day dot renderer ────────────────────────────────────────────────────

// Dots grow small→large along a directional gradient (halftone fade effect)
function drawHalftoneGradient(
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
function drawSunburst(
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
function drawColorBlock(
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
function drawVignette(
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
function drawRadialDots(
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
function drawDiagonalStripes(
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
function drawConcentricRings(
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
function drawCornerBurst(
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

// ─── Per-panel background configuration ──────────────────────────────────────

type PanelBgStyle =
    | 'halftone-gradient'
    | 'sunburst'
    | 'color-block'
    | 'vignette'
    | 'radial-dots'
    | 'diagonal-stripes'
    | 'concentric-rings'
    | 'corner-burst'

interface PanelBgConfig {
    style: PanelBgStyle
    bg: string
    dotColor: string
    dotColor2?: string
    bg2?: string
    rayColor?: string
    baseSpacing: number
    baseRadius: number
    phase: number
    angleDeg?: number
    focalX?: number
    focalY?: number
    rayCount?: number
    splitY?: number
    cornerX?: number
    cornerY?: number
}

const PANEL_BG_CONFIGS: PanelBgConfig[] = [
    // 0 logo — halftone gradient: dense top-left, sparse bottom-right, warm yellow
    {
        style: 'halftone-gradient', bg: '#FFFDE7', dotColor: '#D4A800',
        baseSpacing: 13, baseRadius: 3.5, phase: 0.0, angleDeg: 225
    },
    // 1 switchboard — slowly rotating sunburst from center, cobalt blue
    {
        style: 'sunburst', bg: '#DCEEFF', dotColor: '#0057B8', rayColor: '#0077E6',
        baseSpacing: 15, baseRadius: 3.5, phase: 0.8,
        focalX: 0.5, focalY: 0.5, rayCount: 22
    },
    // 2 mailman1 — color-block: crimson top zone / amber-cream bottom zone
    {
        style: 'color-block', bg: '#FFF0F3', dotColor: '#E8003D',
        dotColor2: '#CC8800', bg2: '#FFFCEB',
        baseSpacing: 13, baseRadius: 3.0, phase: 1.6, splitY: 0.42
    },
    // 3 mechanic — ink vignette: dark green ring fades to bright center
    {
        style: 'vignette', bg: '#F2FFF7', dotColor: '#007A3C',
        baseSpacing: 13, baseRadius: 4.2, phase: 2.4
    },
    // 4 receptionist — radial dots from top-center focal point, hot magenta
    {
        style: 'radial-dots', bg: '#FFF0F9', dotColor: '#C50076',
        baseSpacing: 14, baseRadius: 3.5, phase: 3.2,
        focalX: 0.5, focalY: 0.05
    },
    // 5 rolodex — diagonal stripes at 45 deg, vivid cyan
    {
        style: 'diagonal-stripes', bg: '#E6FAFF', dotColor: '#007BAA',
        baseSpacing: 14, baseRadius: 4.0, phase: 4.0, angleDeg: 45
    },
    // 6 rotary phone — concentric rings pulsing outward, golden yellow
    {
        style: 'concentric-rings', bg: '#FFFBE0', dotColor: '#B88A00',
        baseSpacing: 13, baseRadius: 3.5, phase: 4.8,
        focalX: 0.5, focalY: 0.5
    },
    // 7 mailman2 — corner burst from top-right + radial halftone, deep blue
    {
        style: 'corner-burst', bg: '#E6EDFF', dotColor: '#003F99', rayColor: '#0057B8',
        baseSpacing: 15, baseRadius: 3.8, phase: 5.6,
        cornerX: 1.0, cornerY: 0.0, rayCount: 20
    },
]

function drawPanelBackground(
    ctx: CanvasRenderingContext2D,
    w: number, h: number,
    cfg: PanelBgConfig,
    t: number,
) {
    ctx.clearRect(0, 0, w, h)
    const breathe = Math.sin((t + cfg.phase) * (Math.PI * 2 / 3)) * 0.35
    switch (cfg.style) {
        case 'halftone-gradient':
            drawHalftoneGradient(ctx, w, h, cfg.dotColor, cfg.bg,
                cfg.baseSpacing, cfg.baseRadius, cfg.angleDeg ?? 225, breathe)
            break
        case 'sunburst':
            drawSunburst(ctx, w, h, cfg.dotColor, cfg.bg, cfg.rayColor ?? cfg.dotColor,
                cfg.baseSpacing, cfg.baseRadius,
                cfg.focalX ?? 0.5, cfg.focalY ?? 0.5, cfg.rayCount ?? 18, breathe, t)
            break
        case 'color-block':
            drawColorBlock(ctx, w, h, cfg.dotColor, cfg.bg,
                cfg.dotColor2 ?? cfg.dotColor, cfg.bg2 ?? cfg.bg,
                cfg.baseSpacing, cfg.baseRadius, cfg.splitY ?? 0.5, breathe)
            break
        case 'vignette':
            drawVignette(ctx, w, h, cfg.dotColor, cfg.bg,
                cfg.baseSpacing, cfg.baseRadius, breathe)
            break
        case 'radial-dots':
            drawRadialDots(ctx, w, h, cfg.dotColor, cfg.bg,
                cfg.baseSpacing, cfg.baseRadius,
                cfg.focalX ?? 0.5, cfg.focalY ?? 0.5, breathe)
            break
        case 'diagonal-stripes':
            drawDiagonalStripes(ctx, w, h, cfg.dotColor, cfg.bg,
                cfg.baseSpacing, cfg.baseRadius, cfg.angleDeg ?? 45, breathe)
            break
        case 'concentric-rings':
            drawConcentricRings(ctx, w, h, cfg.dotColor, cfg.bg,
                cfg.baseSpacing, cfg.baseRadius,
                cfg.focalX ?? 0.5, cfg.focalY ?? 0.5, breathe, t)
            break
        case 'corner-burst':
            drawCornerBurst(ctx, w, h, cfg.dotColor, cfg.bg, cfg.rayColor ?? cfg.dotColor,
                cfg.baseSpacing, cfg.baseRadius,
                cfg.cornerX ?? 0, cfg.cornerY ?? 0, cfg.rayCount ?? 16, breathe)
            break
    }
}

// ─── Panel geometry ─────────────────────────────────────────────────────────
// Panel rectangles are sized from each picture's own aspect ratio — see
// panelLayout.ts. Re-exported so consumers keep their type-only import from Layout
// without closing an import cycle through the lazy editor overlay.

export type { PanelPoly } from './panelLayout'

// ─── Page-accent map ─────────────────────────────────────────────────────────

const PAGE_ACCENT: Record<string, string> = {
    '/': '#FFE033',
    '/phone-lines': '#0057B8',
    '/extensions': '#E8003D',
}

function accentForPath(path: string): string {
    return PAGE_ACCENT[path] ?? '#00AEEF'
}

// ─── Panel contents ─────────────────────────────────────────────────────────
// A panel is a slot in the grid and nothing more: its label, whether it is the logo
// and where it navigates live in PANELS (./panels.ts), index-parallel to the polygons
// computeLayout returns.
//
// What is *drawn* in a panel is not parallel to anything. Pictures come from
// PANEL_IMG_TRANSFORMS and bubbles from PANEL_BUBBLE_TRANSFORMS (both in
// editor/layoutConfig.ts, the source of truth); each entry names the `panel` it sits
// on, so a panel may own several or none, and PanelImages.tsx / PanelBubbles.tsx
// filter. A picture carries its own frame over the panel box, which is what lets two
// of them share a panel. A bubble's outline is generated vector geometry
// (bubbleShape.ts) drawn by PanelBubble.tsx; connector tubes between linked bubbles
// are drawn by BubbleTubes.tsx.

// ─── Dev-only editor overlay (lazy) ────────────────────────────────────────────
// Gated on import.meta.env.DEV at module scope: in a production build this static
// `false` lets Rollup eliminate the branch and drop the overlay's chunk entirely.
const EditorOverlay = import.meta.env.DEV
    ? lazy(() => import('./editor/EditorOverlay'))
    : null

// ─── Layout ──────────────────────────────────────────────────────────────────

// children intentionally not rendered — panels-only foundation phase. navItems
// only feeds the dev editor's page selector (no in-page nav chrome yet).
export function Layout({ navItems }: LayoutProps) {
    const navigate = useNavigate()
    const location = useLocation()
    const editor = useEditorMode()

    // Source transforms from the editor's working copy when active, else constants.
    const imgT = editor.active ? editor.config.images : PANEL_IMG_TRANSFORMS
    const bubbleT = editor.active ? editor.config.bubbles : PANEL_BUBBLE_TRANSFORMS

    const panelDotRefs = useRef<(HTMLCanvasElement | null)[]>([])
    const washRef = useRef<HTMLCanvasElement | null>(null)
    const washRafRef = useRef<number>(0)
    const rafRef = useRef<number>(0)
    const prevPathRef = useRef(location.pathname)
    const settledCountRef = useRef(0)

    const [panelPolys, setPanelPolys] = useState<PanelPoly[]>(() =>
        typeof window === 'undefined'
            ? []
            : computeLayout(window.innerWidth, window.innerHeight)
    )
    // Natural (intrinsic) pixel size of each loaded source, captured on load and keyed
    // by `src`. Drives fullImgStyle (the real framing); absent until the img loads,
    // during which the equivalent object-fit:contain fallback renders. Keyed by source
    // rather than by index because two pictures may be the same file, and the second
    // should not have to wait for its own load to learn a size already known.
    const [natSizes, setNatSizes] = useState<Record<string, { w: number; h: number }>>({})
    // True once every panel image has loaded or errored.
    const [ready, setReady] = useState(false)
    // 0 on first visit (no cache), 400 on return visits (assets likely cached).
    const loaderDelay = localStorage.getItem('comic-book:loaded') ? 400 : 0
    const [showLoading, setShowLoading] = useState(false)

    const loadingCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const loadingRafRef = useRef<number>(0)
    const leaveRafRef = useRef<number>(0)
    const [dotCount, setDotCount] = useState(1)
    // True while the loading sheet is being washed away to reveal the ready page.
    const [loadingLeaving, setLoadingLeaving] = useState(false)
    // Dev editor: force-show the loading screen so it can be previewed/tuned.
    const [previewLoading, setPreviewLoading] = useState(false)

    // Which panel the pointer is over, or null. Bubble reveal moved off CSS :hover
    // and into state because the tube layer is a viewport-level sibling of the panels
    // and needs the same answer, which CSS cannot hand it.
    const [hovered, setHovered] = useState<number | null>(null)
    const bubbleVisible = (i: number): boolean =>
        isBubbleRevealed(bubbleT, hovered, editor.active, i)

    // One tick per picture element that has loaded or failed. Counted against the
    // number of pictures actually on the page, which the author can now change — a
    // fixed 8 would leave the page hidden behind the loader the moment one was deleted.
    const imgCount = imgT.length
    const markSettled = useCallback(() => {
        settledCountRef.current += 1
        if (settledCountRef.current >= imgCount) setReady(true)
    }, [imgCount])

    /** Remember a source's natural size the first time it loads. */
    const recordNatSize = useCallback((src: string, size: { w: number; h: number }) => {
        setNatSizes(prev => (prev[src] ? prev : { ...prev, [src]: size }))
    }, [])

    const accent = accentForPath(location.pathname)

    // The loading overlay is live while assets load — or while the editor previews it.
    const loadingActive = (showLoading && !ready) || previewLoading

    // Editor toggle for the loading-screen preview: leaving it replays the exit
    // wash; entering it cancels any in-flight exit so the sheet stays put.
    const handlePreviewLoading = (on: boolean) => {
        if (on === previewLoading) return
        setLoadingLeaving(!on)
        setPreviewLoading(on)
    }

    // ── Ben-Day dot animation loop ────────────────────────────────────────────
    const animatePanelDots = useCallback(() => {
        const t = performance.now() / 1000
        for (let i = 0; i < PANEL_BG_CONFIGS.length; i++) {
            const canvas = panelDotRefs.current[i]
            if (!canvas) continue
            const ctx = canvas.getContext('2d')
            if (!ctx) continue
            const ow = canvas.offsetWidth
            const oh = canvas.offsetHeight
            if (ow > 0 && oh > 0 && (canvas.width !== ow || canvas.height !== oh)) {
                canvas.width = ow
                canvas.height = oh
            }
            if (canvas.width === 0 || canvas.height === 0) continue
            drawPanelBackground(ctx, canvas.width, canvas.height, PANEL_BG_CONFIGS[i], t)
        }
        rafRef.current = requestAnimationFrame(animatePanelDots)
    }, [])

    // ── Resize handler — recompute panel polygons ─────────────────────────────
    const handleResize = useCallback(() => {
        const w = window.innerWidth
        const h = window.innerHeight
        setPanelPolys(computeLayout(w, h))
    }, [])

    useLayoutEffect(() => { handleResize() }, [handleResize])

    useEffect(() => {
        window.addEventListener('resize', handleResize)
        rafRef.current = requestAnimationFrame(animatePanelDots)
        return () => {
            window.removeEventListener('resize', handleResize)
            cancelAnimationFrame(rafRef.current)
        }
    }, [handleResize, animatePanelDots])

    // ── Page transition — Ben-Day wash ────────────────────────────────────────
    // A halftone wave sweeps from the top-left corner: paper dots grow until they
    // merge into a solid sheet carrying the loading screen's ripple, then the
    // wave passes on and the dots shrink away to reveal the new page.
    useEffect(() => {
        if (location.pathname === prevPathRef.current) return
        prevPathRef.current = location.pathname

        const canvas = washRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight

        const start = performance.now()
        cancelAnimationFrame(washRafRef.current)
        const loop = (now: number) => {
            const { cover, reveal, done } = washPhaseAt(now - start)
            drawWash(ctx, canvas.width, canvas.height, cover, reveal, now / 1000, accent)
            if (done) {
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                return
            }
            washRafRef.current = requestAnimationFrame(loop)
        }
        washRafRef.current = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(washRafRef.current)
    }, [location.pathname, accent])

    // Show "LOADING" after loaderDelay — 0 on first visit, 400 ms on return visits.
    // When the page becomes ready while the overlay is up, hand off to the leave
    // wash instead of snapping the overlay away.
    useEffect(() => {
        if (ready) {
            localStorage.setItem('comic-book:loaded', '1')
            if (showLoading) {
                setShowLoading(false)
                setLoadingLeaving(true)
            }
            return
        }
        if (showLoading) return
        const timer = setTimeout(() => setShowLoading(true), loaderDelay)
        return () => clearTimeout(timer)
    }, [ready, showLoading, loaderDelay])

    // ── Loading screen: cycling dots (1 → 2 → 3 → 1…) ───────────────────────────
    useEffect(() => {
        if (!loadingActive) return
        setDotCount(1)
        const id = setInterval(() => setDotCount(d => d === 3 ? 1 : d + 1), 450)
        return () => clearInterval(id)
    }, [loadingActive])

    // ── Loading screen: animated Ben-Day dot background canvas ───────────────────
    useEffect(() => {
        if (!loadingActive) return
        const canvas = loadingCanvasRef.current
        if (!canvas) return
        const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
        resize()
        window.addEventListener('resize', resize)
        const loop = () => {
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            drawLoadingRipple(ctx, canvas.width, canvas.height, performance.now() / 1000, accent)
            loadingRafRef.current = requestAnimationFrame(loop)
        }
        loadingRafRef.current = requestAnimationFrame(loop)
        return () => {
            window.removeEventListener('resize', resize)
            cancelAnimationFrame(loadingRafRef.current)
        }
    }, [loadingActive, accent])

    // ── Loading screen exit: wash the ripple sheet away to reveal the page ───────
    // Reuses the wash's reveal phase (cover pinned at 1) so the loading screen
    // ends exactly the way a page transition does.
    useEffect(() => {
        if (!loadingLeaving) return
        const canvas = loadingCanvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) { setLoadingLeaving(false); return }
        const start = performance.now()
        const loop = (now: number) => {
            const { reveal, done } = washPhaseAt(WASH_COVER_MS + WASH_HOLD_MS + (now - start))
            drawWash(ctx, canvas.width, canvas.height, 1, reveal, now / 1000, accent)
            if (done) {
                setLoadingLeaving(false)
                return
            }
            leaveRafRef.current = requestAnimationFrame(loop)
        }
        leaveRafRef.current = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(leaveRafRef.current)
    }, [loadingLeaving, accent])

    return (
        <>
            <div
                className={`cb-root${editor.active ? ' cb-edit-active' : ''}`}
                style={{ opacity: ready ? 1 : 0, transition: ready ? 'opacity 150ms ease-in' : 'none' }}
            >
                {/* Layer 1 — Image panels (overflow: visible allows spill into gutters) */}
                {panelPolys.map((poly, i) => {
                    const info = PANELS[i]
                    if (!info) return null

                    const { bounds, vp } = poly

                    // The dots clip tightly to the panel polygon (element-relative px
                    // coords). A picture clips to its own frame instead — the same shape
                    // scaled into it — which PanelImages works out per picture.
                    const dotClip = toClipPath(vp, bounds.x, bounds.y)

                    // While editing, the selected picture reveals its full self (clip off)
                    // so the whole of it stays visible for framing; the outline SVG still
                    // draws the crop shape on top. The panel is lifted whenever any of its
                    // pictures is the revealed one.
                    const revealFull = imgT.some(
                        (img, k) =>
                            img.panel === i && shouldRevealImg(editor.active, editor.selected, k),
                    )

                    return (
                        <div
                            key={i}
                            className={[
                                'cb-panel',
                                info.isLogo ? 'logo' : '',
                                info.path ? 'clickable' : '',
                                revealFull ? 'cb-panel-reveal' : '',
                                // Lift the panel over the ink-line SVG while its
                                // bubbles show, so they are not crossed by frame ink.
                                !editor.active && hovered === i ? 'cb-panel-lift' : '',
                            ].filter(Boolean).join(' ')}
                            role={info.path ? 'button' : undefined}
                            tabIndex={info.path ? 0 : undefined}
                            style={{
                                position: 'absolute',
                                left: bounds.x,
                                top: bounds.y,
                                width: bounds.w,
                                height: bounds.h,
                                overflow: 'visible',
                            }}
                            onMouseEnter={() => setHovered(i)}
                            onMouseLeave={() => setHovered(prev => (prev === i ? null : prev))}
                            onClick={() => info.path && navigate(info.path)}
                            onKeyDown={e => {
                                if ((e.key === 'Enter' || e.key === ' ') && info.path) {
                                    e.preventDefault()
                                    navigate(info.path)
                                }
                            }}
                        >
                            {/* Ben-Day dots — clipped to tight panel polygon */}
                            <canvas
                                ref={el => { panelDotRefs.current[i] = el }}
                                className="cb-dots-panel-canvas"
                                style={{ clipPath: dotClip }}
                            />
                            {/* Pictures — however many name this panel, each on its own frame
                                over the panel box, each cut to the panel's shape scaled into
                                that frame. `spill` (and the editor's full-reveal selection)
                                drops the clip so a picture pops out over the frame lines. */}
                            <PanelImages
                                images={imgT}
                                panel={i}
                                bounds={bounds}
                                vp={vp}
                                natSizes={natSizes}
                                isRevealed={k => shouldRevealImg(editor.active, editor.selected, k)}
                                onSettled={markSettled}
                                onNatSize={recordNatSize}
                            />
                            {/* Speech bubbles — generated vector outlines (PanelBubble), however
                                many name this panel. Revealed while this panel is hovered, or
                                always in edit mode. */}
                            <PanelBubbles
                                bubbles={bubbleT}
                                panel={i}
                                clip={dotClip}
                                isVisible={bubbleVisible}
                                interactive={!editor.active}
                            />
                        </div>
                    )
                })}

                {/* Connector tubes between linked bubbles — one viewport-level layer, because
                    a bubble spills past its panel and the corridor joining two of them runs
                    through the gutter. Painted above the bubbles so each tube welds into
                    both mouths. */}
                <BubbleTubes polys={panelPolys} bubbles={bubbleT} isVisible={bubbleVisible} />

                {/* Layer 2 — Panel outline SVG (sits above images, below the wash) */}
                <svg
                    className="cb-panel-svg"
                    aria-hidden="true"
                >
                    {panelPolys.map((poly, i) => (
                        <polygon
                            key={i}
                            points={poly.vp.map(([x, y]) => `${x},${y}`).join(' ')}
                            fill="none"
                            stroke="#111111"
                            strokeWidth="5"
                            strokeLinejoin="miter"
                        />
                    ))}
                </svg>

                {/* Layer 3 — Ben-Day wash canvas (page transitions; blank when idle) */}
                <canvas ref={washRef} className="cb-wash-canvas" aria-hidden="true" />

            </div>

            {/* Dev-only editor overlay — never reached in a production build */}
            {EditorOverlay && editor.active && (
                <Suspense fallback={null}>
                    <EditorOverlay
                        api={editor}
                        panelPolys={panelPolys}
                        pageSelect={{
                            navItems,
                            previewingLoading: previewLoading,
                            onPreviewLoading: handlePreviewLoading,
                        }}
                    />
                </Suspense>
            )}

            {/* Loading indicator — outside cb-root so it's visible while the page is opacity:0.
                Stays mounted through the leave wash so the sheet can wash away over the page. */}
            {(loadingActive || loadingLeaving) && (
                <div
                    className={`cb-loading-overlay${loadingLeaving ? ' cb-loading-leaving' : ''}`}
                    aria-live="polite"
                >
                    <canvas ref={loadingCanvasRef} className="cb-loading-canvas" />
                    <span className="cb-loading-text">
                        LOADING<span className="cb-loading-dots" aria-hidden="true">
                            <span style={{ opacity: dotCount >= 1 ? 1 : 0 }}>.</span>
                            <span style={{ opacity: dotCount >= 2 ? 1 : 0 }}>.</span>
                            <span style={{ opacity: dotCount >= 3 ? 1 : 0 }}>.</span>
                        </span>
                    </span>
                </div>
            )}
        </>
    )
}
