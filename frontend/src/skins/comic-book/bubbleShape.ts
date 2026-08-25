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
import { RING_POINTS, ELLIPSE, cloudPuffs, ringTheta, tailRingIndex, tailTip } from './bubbleBox'
import type { Puff, TailDir } from './bubbleBox'
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
  return buildRing(mod, reach, tail)
}

/** Sample one ring from a modulation and a tail reach — the body of `ringPoints`,
 *  shared with the hit region, which is built from a modulation no type owns. */
function buildRing(mod: (i: number) => number, reach: number, tail: TailDir): number[] {
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
  b: BubbleShapes,
  state: { hover: boolean; pulsing: boolean },
): BubbleType {
  if (state.pulsing && b.clickType) return b.clickType
  if (state.hover && b.hoverType) return b.hoverType
  return b.type
}

/** The shape-bearing fields of a bubble — all `resolveBubbleShape` reads. */
interface BubbleShapes {
  type: BubbleType
  hoverType: BubbleType | null
  clickType: BubbleType | null
}

/**
 * Every shape `b` can resolve to, resting one first. The counterpart of
 * {@link resolveBubbleShape}: it enumerates exactly the branches that function can
 * take, so a new state-driven shape has to be added to both or the hit region below
 * stops covering one of them.
 */
export function bubbleShapeCandidates(b: BubbleShapes): BubbleType[] {
  return [...new Set([b.type, b.hoverType, b.clickType].filter((t): t is BubbleType => !!t))]
}

/**
 * How far the hit region reaches past the geometry it stands in for, in view units.
 *
 * Two things need the slack. The painted outline is stroked, so its ink — and the
 * `visiblePainted` area that used to be the hit target — already sits half a stroke
 * *outside* the path. And the union below is exact only where the shapes are radial
 * modulations of the base ellipse, which the displaced tail vertex is not. A hit
 * region a hair too large is harmless; one a hair too small is the flicker again.
 */
const HIT_PAD = 4

/** Move (x, y) `pad` units further along the direction (dx, dy), which need not be unit. */
function pushOut(x: number, y: number, dx: number, dy: number, pad: number): [number, number] {
  const d = Math.hypot(dx, dy)
  return d === 0 ? [x, y] : [x + (dx / d) * pad, y + (dy / d) * pad]
}

/**
 * One shape's outline, grown by {@link HIT_PAD}: the region that takes pointer events
 * on behalf of `type`.
 *
 * A bubble's hit region is one of these **per shape it can take** (see
 * {@link bubbleShapeCandidates}), overlaid — overlapping siblings in one group hit-test
 * as their union, so the region is the union of the shapes without anything here
 * having to compute one. That matters because the alternative, a single ring taking
 * the largest radius at each vertex, is a true union only where the shapes are radial
 * modulations of the base ellipse, and the displaced tail vertex is not: an authored
 * spike sitting on the tail index has no vertex left to be widest at.
 *
 * Why a union at all: a hit region that morphs with the shape feeds back into itself.
 * Hover a soft balloon whose `hoverType` is a thought cloud, with the cursor over one
 * of the places the cloud's concave cusps cut inside the ellipse — the hover lands,
 * the outline pulls away from the cursor, `pointerleave` fires, the shape returns to
 * soft, the cursor is inside it again, and the two trade places for as long as the
 * pointer sits still. No shape can leave the union, so the union cannot do that.
 *
 * The tail vertex is padded along its own wedge rather than along the ellipse ray. A
 * tail is a long thin triangle whose axis, on a squashed ellipse, is nowhere near the
 * ray its tip sits on, so a radial pad slides the tip sideways out of that triangle
 * and leaves the drawn tip outside the region meant to cover it.
 */
export function hitRingPoints(type: BubbleType, tail: TailDir = 'none'): number[] {
  const { mod, tail: reach } = SHAPES[type]
  const ring = buildRing(mod, reach, tail)
  const out: number[] = []
  for (let i = 0; i < ring.length; i += 2) {
    out.push(
      ...pushOut(ring[i], ring[i + 1], ring[i] - ELLIPSE.cx, ring[i + 1] - ELLIPSE.cy, HIT_PAD),
    )
  }
  const idx = reach > 0 ? tailRingIndex(tail) : -1
  if (idx >= 0) {
    // Aim away from the midpoint of the tail's two roots — the wedge's own axis.
    const before = ((idx + RING_POINTS - 1) % RING_POINTS) * 2
    const after = ((idx + 1) % RING_POINTS) * 2
    const [tipX, tipY] = [ring[idx * 2], ring[idx * 2 + 1]]
    const rootX = (out[before] + out[after]) / 2
    const rootY = (out[before + 1] + out[after + 1]) / 2
    ;[out[idx * 2], out[idx * 2 + 1]] = pushOut(tipX, tipY, tipX - rootX, tipY - rootY, HIT_PAD)
  }
  return out
}

/**
 * Hit-target puffs for `b` — the trailing thought puffs, padded to match
 * {@link hitRingPoints}, or none when no shape it can take grows them.
 *
 * They are detached from the ring, so they are a second piece of the hit region and
 * have to obey the same rule: present for a bubble that only becomes a cloud on
 * hover, not just for one drawn as a cloud right now. Otherwise the puff that
 * appears under the cursor on hover has nothing holding the hover, and the fade in
 * and out is the same oscillation the ring used to have.
 */
export function hitPuffs(b: BubbleShapes, tail: TailDir = 'none'): Puff[] {
  const grows = bubbleShapeCandidates(b).some(t => SHAPES[t].puffs > 0)
  return grows ? cloudPuffs(tail).map(p => ({ ...p, r: p.r + HIT_PAD })) : []
}
