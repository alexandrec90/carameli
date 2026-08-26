import {
    drawColorBlock, drawDiagonalStripes, drawHalftoneGradient, drawRadialDots,
    drawVignette,
} from './patternDrawFields'
import {
    drawConcentricRings, drawCornerBurst, drawSunburst,
} from './patternDrawRadial'

// ─── Pattern style registry ──────────────────────────────────────────────────
// The editable half of a panel background. Which style each panel *shows* is the
// author's choice and lives in editor/layoutConfig.ts (PANEL_PATTERNS, parallel to
// PANELS); this module owns the vocabulary of styles and the per-panel palette and
// dot metrics that stay tuned whichever style is picked.

export type PanelBgStyle =
    | 'halftone-gradient'
    | 'sunburst'
    | 'color-block'
    | 'vignette'
    | 'radial-dots'
    | 'diagonal-stripes'
    | 'concentric-rings'
    | 'corner-burst'

export const PATTERN_STYLES: Record<PanelBgStyle, { label: string }> = {
    'halftone-gradient': { label: 'Halftone gradient' },
    'sunburst': { label: 'Sunburst' },
    'color-block': { label: 'Color block' },
    'vignette': { label: 'Vignette' },
    'radial-dots': { label: 'Radial dots' },
    'diagonal-stripes': { label: 'Diagonal stripes' },
    'concentric-rings': { label: 'Concentric rings' },
    'corner-burst': { label: 'Corner burst' },
}

/** Every style name, in registry order — the editor's dropdown reads this. */
export const PATTERN_STYLE_KEYS = Object.keys(PATTERN_STYLES) as PanelBgStyle[]

/**
 * True when `v` names a pattern style that still exists. `hasOwnProperty` rather
 * than `in`, so a name that is really a prototype member ('toString') is rejected.
 */
export function isPanelBgStyle(v: unknown): v is PanelBgStyle {
    return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PATTERN_STYLES, v)
}

// ─── Per-panel background tuning ─────────────────────────────────────────────

/**
 * A panel's palette and dot metrics — everything about its background *except*
 * the style name, which the author picks per panel in the editor. Fields a given
 * style does not read are simply ignored, which is what lets one panel's tuning
 * survive a style switch.
 */
export interface PanelBgConfig {
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

/** Index-parallel to PANELS — a panel's tuning belongs to the slot, not a picture. */
export const PANEL_BG_CONFIGS: PanelBgConfig[] = [
    // 0 logo — dense top-left fading bottom-right, warm yellow
    {
        bg: '#FFFDE7', dotColor: '#D4A800',
        baseSpacing: 13, baseRadius: 3.5, phase: 0.0, angleDeg: 225
    },
    // 1 switchboard — center focal point, cobalt blue
    {
        bg: '#DCEEFF', dotColor: '#0057B8', rayColor: '#0077E6',
        baseSpacing: 15, baseRadius: 3.5, phase: 0.8,
        focalX: 0.5, focalY: 0.5, rayCount: 22
    },
    // 2 mailman1 — crimson top zone / amber-cream bottom zone
    {
        bg: '#FFF0F3', dotColor: '#E8003D',
        dotColor2: '#CC8800', bg2: '#FFFCEB',
        baseSpacing: 13, baseRadius: 3.0, phase: 1.6, splitY: 0.42
    },
    // 3 mechanic — dark green ring fades to bright center
    {
        bg: '#F2FFF7', dotColor: '#007A3C',
        baseSpacing: 13, baseRadius: 4.2, phase: 2.4
    },
    // 4 receptionist — top-center focal point, hot magenta
    {
        bg: '#FFF0F9', dotColor: '#C50076',
        baseSpacing: 14, baseRadius: 3.5, phase: 3.2,
        focalX: 0.5, focalY: 0.05
    },
    // 5 rolodex — 45 deg bands, vivid cyan
    {
        bg: '#E6FAFF', dotColor: '#007BAA',
        baseSpacing: 14, baseRadius: 4.0, phase: 4.0, angleDeg: 45
    },
    // 6 rotary phone — pulsing outward from center, golden yellow
    {
        bg: '#FFFBE0', dotColor: '#B88A00',
        baseSpacing: 13, baseRadius: 3.5, phase: 4.8,
        focalX: 0.5, focalY: 0.5
    },
    // 7 mailman2 — top-right corner focus, deep blue
    {
        bg: '#E6EDFF', dotColor: '#003F99', rayColor: '#0057B8',
        baseSpacing: 15, baseRadius: 3.8, phase: 5.6,
        cornerX: 1.0, cornerY: 0.0, rayCount: 20
    },
    // 8 logo2 — center focal point, warm yellow (home page)
    {
        bg: '#FFFDE7', dotColor: '#D4A800',
        baseSpacing: 13, baseRadius: 3.5, phase: 6.4,
        focalX: 0.5, focalY: 0.5
    },
    // 9 notepad — 135 deg bands, cobalt blue (home page)
    {
        bg: '#E8F1FF', dotColor: '#0057B8',
        baseSpacing: 14, baseRadius: 4.0, phase: 7.2, angleDeg: 135
    },
    // 10 push-button phone — center focal point, crimson (home page)
    {
        bg: '#FFF0F3', dotColor: '#E8003D',
        baseSpacing: 13, baseRadius: 3.5, phase: 8.0,
        focalX: 0.5, focalY: 0.5
    },
    // 11 conversation — mid focal point, spring green (home page)
    {
        bg: '#F2FFF7', dotColor: '#007A3C', rayColor: '#00A651',
        baseSpacing: 15, baseRadius: 3.5, phase: 8.8,
        focalX: 0.5, focalY: 0.45, rayCount: 20
    },
]

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Paint one panel's background at clock `t` (seconds). `t` is the *panel's* clock,
 * not wall time: it advances only while the panel is active, so a panel at rest
 * holds the frame it stopped on (panelDotAnim.ts). Every style moves with it —
 * there is no style whose output is the same at two different `t`.
 */
export function drawPanelBackground(
    ctx: CanvasRenderingContext2D,
    w: number, h: number,
    style: PanelBgStyle,
    cfg: PanelBgConfig,
    t: number,
) {
    ctx.clearRect(0, 0, w, h)
    const breathe = Math.sin((t + cfg.phase) * (Math.PI * 2 / 3)) * 0.35
    switch (style) {
        case 'halftone-gradient':
            drawHalftoneGradient(ctx, w, h, cfg.dotColor, cfg.bg,
                cfg.baseSpacing, cfg.baseRadius, cfg.angleDeg ?? 225, breathe, t)
            break
        case 'sunburst':
            drawSunburst(ctx, w, h, cfg.dotColor, cfg.bg, cfg.rayColor ?? cfg.dotColor,
                cfg.baseSpacing, cfg.baseRadius,
                cfg.focalX ?? 0.5, cfg.focalY ?? 0.5, cfg.rayCount ?? 18, breathe, t)
            break
        case 'color-block':
            drawColorBlock(ctx, w, h, cfg.dotColor, cfg.bg,
                cfg.dotColor2 ?? cfg.dotColor, cfg.bg2 ?? cfg.bg,
                cfg.baseSpacing, cfg.baseRadius, cfg.splitY ?? 0.5, breathe, t)
            break
        case 'vignette':
            drawVignette(ctx, w, h, cfg.dotColor, cfg.bg,
                cfg.baseSpacing, cfg.baseRadius, breathe, t)
            break
        case 'radial-dots':
            drawRadialDots(ctx, w, h, cfg.dotColor, cfg.bg,
                cfg.baseSpacing, cfg.baseRadius,
                cfg.focalX ?? 0.5, cfg.focalY ?? 0.5, breathe, t)
            break
        case 'diagonal-stripes':
            drawDiagonalStripes(ctx, w, h, cfg.dotColor, cfg.bg,
                cfg.baseSpacing, cfg.baseRadius, cfg.angleDeg ?? 45, breathe, t)
            break
        case 'concentric-rings':
            drawConcentricRings(ctx, w, h, cfg.dotColor, cfg.bg,
                cfg.baseSpacing, cfg.baseRadius,
                cfg.focalX ?? 0.5, cfg.focalY ?? 0.5, breathe, t)
            break
        case 'corner-burst':
            drawCornerBurst(ctx, w, h, cfg.dotColor, cfg.bg, cfg.rayColor ?? cfg.dotColor,
                cfg.baseSpacing, cfg.baseRadius,
                cfg.cornerX ?? 0, cfg.cornerY ?? 0, cfg.rayCount ?? 16, breathe, t)
            break
    }
}
