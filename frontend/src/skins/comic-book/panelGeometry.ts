// Panel polygon geometry: the shared types, constants and helpers every layout
// computation builds from. A leaf module on purpose — the layouts (classicLayouts.ts,
// pageLayouts.ts), the renderer (Layout.tsx) and the editor overlay all need these
// names, and putting them anywhere with dependencies of its own would close a cycle.

// ─── Layout constants ─────────────────────────────────────────────────────────

export const OUTER_M = 8  // margin from viewport edge to outermost panel outline
export const HG = 7       // half-gutter — each panel insets this many px from each divider centre
export const SPILL = 15   // px that images bleed beyond the panel outline on safe outer edges

// ─── Panel polygon types ──────────────────────────────────────────────────────

/** A single panel described by its tight polygon and image-spill geometry. */
export interface PanelPoly {
    /** Tight polygon in absolute viewport coords [TL, TR, BR, BL] */
    vp: [number, number][]
    /** Bounding rect of the tight polygon */
    bounds: { x: number; y: number; w: number; h: number }
    /** Spill polygon in absolute viewport coords (expanded on outer edges) */
    spillVP: [number, number][]
    spillTop: boolean
    spillRight: boolean
    spillBottom: boolean
    spillLeft: boolean
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

export function polyBounds(pts: [number, number][]): { x: number; y: number; w: number; h: number } {
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Expand a [TL, TR, BR, BL] polygon outward on each side. */
export function expandPoly(
    pts: [number, number][],
    top: number, right: number, bottom: number, left: number,
): [number, number][] {
    const [TL, TR, BR, BL] = pts
    return [
        [TL[0] - left, TL[1] - top],
        [TR[0] + right, TR[1] - top],
        [BR[0] + right, BR[1] + bottom],
        [BL[0] - left, BL[1] + bottom],
    ] as [number, number][]
}

export function makePoly(
    tight: [number, number][],
    spillTop: boolean, spillRight: boolean, spillBottom: boolean, spillLeft: boolean,
): PanelPoly {
    const sp = SPILL
    const bounds = polyBounds(tight)
    const spillVP = expandPoly(
        tight,
        spillTop ? sp : 0,
        spillRight ? sp : 0,
        spillBottom ? sp : 0,
        spillLeft ? sp : 0,
    )
    return { vp: tight, bounds, spillVP, spillTop, spillRight, spillBottom, spillLeft }
}
