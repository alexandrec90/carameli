// Vector speech-bubble geometry — pure, no DOM, ships in prod.
//
// Every bubble type is one closed ring of RING_POINTS vertices sampled from the same
// base ellipse (bubbleBox.ts) and differing only in a radial modulation. That is the
// whole design constraint: because all types agree on the vertex count *and* the path
// command sequence, any two of them interpolate vertex-for-vertex, so changing a
// bubble's shape is a true morph rather than the crossfade raster artwork forced.
// Adding a type with a different point count silently breaks every morph into and out
// of it, so keep the ring shared.
//
// The tail is part of that same ring — one vertex pulled out toward a tip — and which
// vertex that is comes from the bubble's own `tail` direction, not from its type. A
// type only says how far the tail reaches (a thought bubble reaches nowhere and trails
// puffs instead); the direction, including having none at all, is the author's.

import { boltMod } from './boltShape'
import { RING_POINTS, ELLIPSE, ringTheta, tailRingIndex, tailTip } from './bubbleBox'
import type { TailDir } from './bubbleBox'
import type { BubbleType } from './editor/bubbleTypes'

const TAU = Math.PI * 2

interface ShapeDef {
  /** Radial modulation at ring index `i`; 1 sits exactly on the base ellipse. */
  mod(i: number): number
  /** How far the tail vertex reaches toward the tip — 0 = never a tail, 1 = full. */
  tail: number
  /** Opacity of the trailing thought puffs. */
  puffs: number
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

const SHAPES: Record<BubbleType, ShapeDef> = {
  // A plain ellipse — 64 straight segments read as smooth at any rendered size.
  soft: { mod: () => 1, tail: 1, puffs: 0 },
  cloud: { mod: cloudMod, tail: 0, puffs: 1 },
  // The impact burst lives in its own module — it is an authored spike table rather
  // than a modulation of the ellipse, and it is longer than the other two together.
  lightning: { mod: boltMod, tail: 0.85, puffs: 0 },
}

/** Round to 2 decimals — path strings are rebuilt every frame during a morph. */
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Sample one bubble outline as a flat `[x0, y0, x1, y1, …]` list in BUBBLE_VIEW
 * units. Index 0 is the top of the ellipse and the ring runs clockwise.
 *
 * `tail` moves the tail to that side of the bubble (`'none'` leaves the ring whole).
 * It is a parameter rather than a property of the type because the two change
 * independently: a bubble keeps pointing at its speaker while its shape morphs from
 * speech to shout, which only works if every shape puts the tail on the same vertex.
 */
export function ringPoints(type: BubbleType, tail: TailDir = 'none'): number[] {
  const { mod, tail: reach } = SHAPES[type]
  const { cx, cy, rx, ry } = ELLIPSE
  const tailIdx = tailRingIndex(tail)
  const [tipX, tipY] = tailTip(tail)
  const out: number[] = []
  for (let i = 0; i < RING_POINTS; i++) {
    const theta = ringTheta(i)
    const m = mod(i)
    let x = cx + rx * m * Math.cos(theta)
    let y = cy + ry * m * Math.sin(theta)
    if (i === tailIdx && reach > 0) {
      x += (tipX - x) * reach
      y += (tipY - y) * reach
    }
    out.push(x, y)
  }
  return out
}

/**
 * Flat point list → a closed SVG path. The command sequence is `M`, `L`×(N−1), `Z`
 * for every type, which is what lets a morph swap `d` mid-flight without the renderer
 * having to reconcile two different path structures.
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
 * Which shape a bubble should currently be. A click pulse outranks a hover, and either
 * falls back to the resting `type` when that event has no shape configured — so an
 * unset `hoverType`/`clickType` means "stay as you are", not "become soft".
 */
export function resolveBubbleShape(
  b: { type: BubbleType; hoverType: BubbleType | null; clickType: BubbleType | null },
  state: { hover: boolean; pulsing: boolean },
): BubbleType {
  if (state.pulsing && b.clickType) return b.clickType
  if (state.hover && b.hoverType) return b.hoverType
  return b.type
}
