// Vector speech-bubble geometry — pure, no DOM, ships in prod.
//
// Every bubble type is one closed ring of RING_POINTS vertices sampled from the
// same base ellipse and differing only in a radial modulation. That is the whole
// design constraint: because all types agree on the vertex count *and* the path
// command sequence, any two of them interpolate vertex-for-vertex, so changing a
// bubble's shape is a true morph rather than the crossfade raster artwork forced.
// Adding a type with a different point count silently breaks every morph into and
// out of it, so keep the ring shared.

import type { BubbleType } from './editor/bubbleTypes'

/** SVG user-space box every bubble path is authored in. */
export const BUBBLE_VIEW = { w: 200, h: 150 } as const

/** Vertices in the outline ring — shared by every type (see the module note). */
export const RING_POINTS = 64

/** Base ellipse, in BUBBLE_VIEW units. Sized to leave room for the tail below it. */
const ELLIPSE = { cx: 100, cy: 58, rx: 84, ry: 44 } as const

/**
 * Ring index pulled out to form the tail — bottom-left of the ellipse. Its two
 * neighbors stay put and become the tail's roots, so the tail is a slender
 * triangle rather than a separate shape, and "grow a tail" morphs like anything
 * else: the vertex simply travels back onto the ring.
 */
const TAIL_INDEX = 39
/** Where the tail vertex reaches when fully extended, in BUBBLE_VIEW units. */
const TAIL_TIP = { x: 34, y: 138 } as const

/**
 * Trailing puffs of a thought bubble. Detached, so they cannot be part of the
 * morph ring — they fade instead (see `puffOpacity`), which reads fine because
 * they are small and the ring is doing the visible work.
 */
export const CLOUD_PUFFS = [
  { cx: 44, cy: 116, r: 7 },
  { cx: 36, cy: 129, r: 4.4 },
  { cx: 30, cy: 139, r: 2.8 },
] as const

/** Rendered bubble height as a fraction of its width — fixed by BUBBLE_VIEW. */
export const BUBBLE_ASPECT = BUBBLE_VIEW.h / BUBBLE_VIEW.w

/**
 * The base ellipse as fractions of the rendered bubble box. A connector tube aims
 * at this rather than at the box: the box corners are empty, so a tube pointed at
 * them would visibly miss the bubble.
 */
export const BUBBLE_ELLIPSE_N = {
  cx: ELLIPSE.cx / BUBBLE_VIEW.w,
  cy: ELLIPSE.cy / BUBBLE_VIEW.h,
  rx: ELLIPSE.rx / BUBBLE_VIEW.w,
  ry: ELLIPSE.ry / BUBBLE_VIEW.h,
} as const

const TAU = Math.PI * 2

interface ShapeDef {
  /** Radial modulation at ring index `i`; 1 sits exactly on the base ellipse. */
  mod(i: number): number
  /** How far the tail vertex reaches toward TAIL_TIP — 0 = no tail, 1 = full. */
  tail: number
  /** Opacity of the trailing thought puffs. */
  puffs: number
}

/**
 * Deterministic [0, 1) jitter. `lightning` needs uneven spikes, and a seeded hash
 * gives them without `Math.random` — so the geometry is stable across renders and
 * assertable in a test.
 */
function jitter(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

/** Polar angle of ring index `i`. Index 0 is the top and the ring runs clockwise. */
function ringTheta(i: number): number {
  return -Math.PI / 2 + (TAU * i) / RING_POINTS
}

/**
 * A thought bubble is a **union of overlapping lobes**, not a wavy ellipse. The
 * lobes are circles of radius CLOUD_LOBE_R centred at CLOUD_LOBE_D in the
 * normalized space where the base ellipse is the unit circle — and that space maps
 * back to BUBBLE_VIEW by an affine transform, so each circle lands as an ellipse:
 * literally a ring of ellipses meshed together.
 *
 * The junction between two adjacent lobes cuts *inside* the base ellipse, and
 * that concave cusp is what makes the outline read as a cloud. A modulation that
 * only ever bulged outward read as a scalloped balloon instead.
 *
 * CLOUD_LOBES divides RING_POINTS, so every lobe crown lands exactly on a vertex
 * rather than drifting between two.
 */
const CLOUD_LOBES = 8
const CLOUD_LOBE_D = 0.75
const CLOUD_LOBE_R = 0.38

/**
 * Radius at which a ray from the centre leaves the lobe union: the far root of the
 * ray/circle intersection, maximized over the lobes. Adjacent lobes overlap by
 * construction, so some lobe always claims the ray — the `|| 1` guards a future
 * retune that pulls them apart, it is not a live code path.
 */
function cloudMod(i: number): number {
  const theta = ringTheta(i)
  const dx = Math.cos(theta)
  const dy = Math.sin(theta)
  let far = 0
  for (let k = 0; k < CLOUD_LOBES; k++) {
    const a = -Math.PI / 2 + (TAU * k) / CLOUD_LOBES
    const cx = CLOUD_LOBE_D * Math.cos(a)
    const cy = CLOUD_LOBE_D * Math.sin(a)
    const proj = cx * dx + cy * dy
    const disc = proj * proj - (cx * cx + cy * cy) + CLOUD_LOBE_R * CLOUD_LOBE_R
    if (disc <= 0) continue
    far = Math.max(far, proj + Math.sqrt(disc))
  }
  return far || 1
}

/**
 * Action-bubble spikes. Each spike owns BOLT_PERIOD vertices and is a *triangle* —
 * valley, straight climb to a crown, straight fall into the next valley — so every
 * turn is a corner instead of the crest of a cosine. Soft edges were the whole
 * complaint about the cosine burst this replaced.
 *
 * Three things are jittered per spike so it cannot read as a sun: crown height,
 * valley depth, and *where in the period the crown sits*. An off-centre crown makes
 * a spike lean, and no two lean alike; the evenly spaced symmetric spikes of a pure
 * radial multiple are exactly the sun look to avoid.
 */
const BOLT_SPIKES = 8
const BOLT_PERIOD = RING_POINTS / BOLT_SPIKES

/** Crown height above the base ellipse. Capped so no spike escapes the viewBox. */
function boltCrown(k: number): number {
  return 0.1 + 0.09 * jitter(3 * k + 1)
}

/** Valley depth below it — deep valleys are what make the crowns read as spikes. */
function boltValley(k: number): number {
  return -0.17 + 0.1 * jitter(3 * k + 2)
}

/**
 * Which vertex of the period carries the crown — 1..6 of 8, so spikes lean hard.
 * A crown at 1 is a shark fin: one steep segment up, six shallow ones back down.
 */
function boltCrownAt(k: number): number {
  return 1 + Math.floor(6 * jitter(5 * k + 2))
}

function lightningMod(i: number): number {
  const k = Math.floor(i / BOLT_PERIOD)
  const j = i % BOLT_PERIOD
  const crownAt = boltCrownAt(k)
  const climbing = j <= crownAt
  const from = climbing ? boltValley(k) : boltCrown(k)
  // The falling edge aims at the *next* spike's valley, so the ring closes seamlessly.
  const to = climbing ? boltCrown(k) : boltValley((k + 1) % BOLT_SPIKES)
  const span = climbing ? crownAt : BOLT_PERIOD - crownAt
  const t = climbing ? j / crownAt : (j - crownAt) / span
  // Per-vertex roughness: the straight edges stay straight-ish, but hand-drawn.
  return 1 + from + (to - from) * t + 0.03 * (jitter(7 * i + 5) - 0.5)
}

const SHAPES: Record<BubbleType, ShapeDef> = {
  // A plain ellipse — 64 straight segments read as smooth at any rendered size.
  soft: { mod: () => 1, tail: 1, puffs: 0 },
  cloud: { mod: cloudMod, tail: 0, puffs: 1 },
  lightning: { mod: lightningMod, tail: 0.85, puffs: 0 },
}

/** Round to 2 decimals — path strings are rebuilt every frame during a morph. */
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Sample one bubble outline as a flat `[x0, y0, x1, y1, …]` list in BUBBLE_VIEW
 * units. Index 0 is the top of the ellipse and the ring runs clockwise.
 */
export function ringPoints(type: BubbleType): number[] {
  const { mod, tail } = SHAPES[type]
  const { cx, cy, rx, ry } = ELLIPSE
  const out: number[] = []
  for (let i = 0; i < RING_POINTS; i++) {
    const theta = ringTheta(i)
    const m = mod(i)
    let x = cx + rx * m * Math.cos(theta)
    let y = cy + ry * m * Math.sin(theta)
    if (i === TAIL_INDEX && tail > 0) {
      x += (TAIL_TIP.x - x) * tail
      y += (TAIL_TIP.y - y) * tail
    }
    out.push(x, y)
  }
  return out
}

/**
 * Flat point list → a closed SVG path. The command sequence is `M`, `L`×(N−1),
 * `Z` for every type, which is what lets a morph swap `d` mid-flight without the
 * renderer having to reconcile two different path structures.
 */
export function pathD(pts: number[]): string {
  const parts: string[] = []
  for (let i = 0; i < pts.length; i += 2) {
    parts.push(`${i === 0 ? 'M' : 'L'} ${r2(pts[i])} ${r2(pts[i + 1])}`)
  }
  parts.push('Z')
  return parts.join(' ')
}

/** Vertex-wise interpolation between two same-length point lists. */
export function lerpPoints(from: number[], to: number[], t: number): number[] {
  const out = new Array<number>(from.length)
  for (let i = 0; i < from.length; i++) out[i] = from[i] + (to[i] - from[i]) * t
  return out
}

/** Ease-out cubic — fast departure, soft landing, no overshoot to correct for. */
export function easeOutCubic(t: number): number {
  const c = 1 - t
  return 1 - c * c * c
}

/** Opacity for the trailing thought puffs of `type` (only `cloud` shows them). */
export function puffOpacity(type: BubbleType): number {
  return SHAPES[type].puffs
}

/**
 * Which shape a bubble should currently be. A click pulse outranks a hover, and
 * either falls back to the resting `type` when that event has no shape configured
 * — so an unset `hoverType`/`clickType` means "stay as you are", not "become soft".
 */
export function resolveBubbleShape(
  b: { type: BubbleType; hoverType: BubbleType | null; clickType: BubbleType | null },
  state: { hover: boolean; pulsing: boolean },
): BubbleType {
  if (state.pulsing && b.clickType) return b.clickType
  if (state.hover && b.hoverType) return b.hoverType
  return b.type
}
