
// The page's panel *shapes*: a shared-vertex subdivision of the page frame, and the
// pure geometry that turns it into the viewport polygons `Layout.tsx` draws.
//
// The three layouts used to be three functions of `(w, h)` here-are-the-numbers, one per
// breakpoint, each spelling every panel corner out with its own `± hg` — so a divider
// existed only as the coincidence that six corner expressions agreed. Moving one meant
// editing six numbers in step, which is why nothing but a human with the file open could
// move one at all.
//
// A grid instead names each corner **once** and lets panels share it by index. A divider
// is then the run of shared vertices between two panels, moving it is moving a vertex,
// and a "lightning bolt" seam is that run with a vertex inserted in the middle. Nothing
// about the outer frame or the gutter is stored: the frame is the viewport inset by
// {@link OUTER_M}, and the gutter is `insetPolygon` shrinking every panel by the same
// {@link HALF_GUTTER} whatever shape or angle it has.

import type { PanelPage } from './panels'
import { insetPolygon, polyBounds } from './polygonInset'

// The gutter inset and the box maths live in ./polygonInset.ts and are re-exported
// here, so a caller still imports its geometry from one module.
export { insetPolygon, polyBounds } from './polygonInset'

/** A point in normalised frame space: 0..1 across the page frame, y down. */
export type NormPt = [number, number]

/** A point in absolute viewport pixels. */
export type VpPt = [number, number]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * One layout's panel subdivision: a table of shared corners, plus one ring of indices
 * into it per panel, clockwise.
 *
 * Panels are index-parallel to `PANELS` (./panels.ts) — a panel is a fixed slot in the
 * grid — but a ring's *length* is not fixed: it grows by one every time a bend is added
 * to one of its seams.
 *
 * The subdivision must **conform**: a vertex that lies on a panel edge has to be one of
 * that edge's own endpoints, in every panel that touches it. A vertex sitting untracked
 * in the middle of a neighbour's edge looks identical until it is dragged, at which point
 * the two panels part company and the gutter tears open. `gridProblems` is what pins it.
 */
export interface PanelGrid {
  vertices: NormPt[]
  panels: number[][]
}

/** Which of the three shapes the viewport is, and so which grid it draws. */
export type LayoutKind = 'landscape' | 'portrait' | 'square'

/** The three grids an author tunes per page; the viewport picks one per resize. */
export type PanelGrids = Record<LayoutKind, PanelGrid>

/**
 * Every page's grids. Which member the route decides (`pageForPath`), which grid
 * inside it the viewport does (`layoutKindFor`). Each grid's ring table is still
 * PANELS-length: a panel that sits on the *other* page holds an empty ring, so a
 * panel keeps one index everywhere and a grid stays checkable against PANELS.
 */
export type PageGrids = Record<PanelPage, PanelGrids>

/** A single panel, ready to draw: its gutter-inset polygon and that polygon's box. */
export interface PanelPoly {
  /** Tight polygon in absolute viewport coords, gutter already taken off. */
  vp: VpPt[]
  /** Bounding rect of the tight polygon. */
  bounds: Rect
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Margin from the viewport edge to the page frame. */
export const OUTER_M = 8

/**
 * Half the gutter: every panel shrinks by this much on every edge, so two neighbours
 * sharing a seam end up exactly `2 × HALF_GUTTER` apart — measured perpendicular to the
 * seam, whatever angle it runs at.
 *
 * That perpendicular measure is the reason this is an inset and not the old per-corner
 * `± hg` on whichever axis looked right: nudging a slanted divider's `x` by 7 leaves a
 * gap of `7 × cos θ`, so the page's gutters used to narrow as its dividers leant over.
 */
export const HALF_GUTTER = 7

/**
 * How close to the frame edge a vertex may be dragged, in normalised units. Keeping
 * interior vertices off the boundary is what makes {@link constraintOf} stable: a vertex
 * cannot change which class it is in, so the outer frame keeps exactly the four corners
 * it started with and no panel can be collapsed against it.
 */
export const EDGE_MARGIN = 0.01

/** Tolerance for "this coordinate is on the frame boundary". */
const ON_EDGE = 1e-6

// ─── Breakpoints ──────────────────────────────────────────────────────────────

/**
 * Which grid a viewport draws. The thresholds are the ones the three hard-coded layout
 * functions used, kept as-is so a given window still gets the page it always got.
 */
export function layoutKindFor(w: number, h: number): LayoutKind {
  const ar = w / (h || 1)
  if (ar < 0.85) return 'portrait'
  if (ar > 1.25) return 'landscape'
  return 'square'
}

/** The page frame: the viewport inset by {@link OUTER_M} on every side. */
export function frameRect(w: number, h: number): Rect {
  return {
    x: OUTER_M,
    y: OUTER_M,
    w: Math.max(0, w - 2 * OUTER_M),
    h: Math.max(0, h - 2 * OUTER_M),
  }
}

/** Normalised point → absolute viewport pixels. */
export function toViewport([nx, ny]: NormPt, f: Rect): VpPt {
  return [f.x + nx * f.w, f.y + ny * f.h]
}

/** Absolute viewport pixels → normalised point (the inverse of {@link toViewport}). */
export function toNormalized([x, y]: VpPt, f: Rect): NormPt {
  return [f.w > 0 ? (x - f.x) / f.w : 0, f.h > 0 ? (y - f.y) / f.h : 0]
}

// ─── Vertex constraints ───────────────────────────────────────────────────────

/**
 * What a vertex is allowed to do. The outer frame is not editable, so a vertex that sits
 * on it may only **slide along** it, and one that sits on two edges at once is a frame
 * corner and may not move at all.
 */
export type VertexConstraint = 'free' | 'top' | 'right' | 'bottom' | 'left' | 'locked'

/** Which constraint a vertex is under, read off where it sits. */
export function constraintOf([x, y]: NormPt): VertexConstraint {
  const onLeft = x <= ON_EDGE
  const onRight = x >= 1 - ON_EDGE
  const onTop = y <= ON_EDGE
  const onBottom = y >= 1 - ON_EDGE
  const edges = [onLeft, onRight, onTop, onBottom].filter(Boolean).length
  if (edges >= 2) return 'locked'
  if (onLeft) return 'left'
  if (onRight) return 'right'
  if (onTop) return 'top'
  if (onBottom) return 'bottom'
  return 'free'
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

/**
 * Put a proposed position back inside what {@link constraintOf} allows: a frame vertex
 * keeps its pinned axis and slides on the other, an interior one stays clear of the
 * frame, and a corner does not move.
 */
export function clampVertex(target: NormPt, constraint: VertexConstraint): NormPt {
  const lo = EDGE_MARGIN
  const hi = 1 - EDGE_MARGIN
  switch (constraint) {
    case 'locked':
      return target
    case 'left':
      return [0, clamp(target[1], lo, hi)]
    case 'right':
      return [1, clamp(target[1], lo, hi)]
    case 'top':
      return [clamp(target[0], lo, hi), 0]
    case 'bottom':
      return [clamp(target[0], lo, hi), 1]
    default:
      return [clamp(target[0], lo, hi), clamp(target[1], lo, hi)]
  }
}

// ─── Grid → drawable panels ───────────────────────────────────────────────────

/** One panel's ring in viewport pixels, before the gutter is taken off. */
export function panelRing(grid: PanelGrid, panel: number, f: Rect): VpPt[] {
  const ring = grid.panels[panel]
  if (!ring) return []
  return ring.map(i => toViewport(grid.vertices[i] ?? [0, 0], f))
}

/**
 * The whole grid as drawable panels for a viewport: each ring mapped into the frame and
 * shrunk by the half-gutter.
 */
export function gridPolys(grid: PanelGrid, w: number, h: number): PanelPoly[] {
  const f = frameRect(w, h)
  return grid.panels.map((_, i) => {
    const vp = insetPolygon(panelRing(grid, i, f), HALF_GUTTER)
    return { vp, bounds: polyBounds(vp) }
  })
}
