// Action-bubble geometry: the 1960s pop-art impact burst. Pure, no DOM, ships in prod.
//
// This is deliberately **not** a modulated ellipse. Any radial function of the angle —
// a cosine, or a triangle wave with jittered amplitude on top — produces spikes that
// are evenly spaced and broadly one length, and that reads as a *sun* however much
// noise is piled onto it. Adding jitter to a smooth burst was the previous attempt and
// it is why the outline still read as soft and organic.
//
// The spikes are therefore a table, not a formula — and the table is **traced, not
// invented**: `public/comic-book/jagged bubble.png` is the reference drawing, and each
// entry below is one of its fifteen real spikes, extracted by sampling the outline's
// radius around its interior centroid, taking the local maxima and minima of that
// radial profile, and quantising them onto the shared ring. Two hand-authored tables
// preceded this one and both read as generic starbursts; what they missed is
// measurable in the trace — the drawing's notches cut far deeper (down to 0.67 of the
// base ellipse) and its spike lengths spread far wider (0.17 to 1.0 of full reach)
// than either table dared.
//
// Each entry owns a run of consecutive ring vertices and is walked as two straight
// segments — valley → crown, then crown → the *next* spike's valley — so every vertex
// is either a corner or a point on a straight edge, and nothing is ever interpolated
// through a curve.
//
// The ring itself still belongs to `bubbleShape.ts`: this module only says how far
// from the centre each of its RING_POINTS vertices sits, in base-ellipse units.

import { BUBBLE_VIEW, ELLIPSE, RING_POINTS, ringTheta } from './bubbleBox'

/**
 * One spike: a run of `span` ring vertices whose `rise`-th vertex carries the crown.
 * `rise` strictly inside the span is what makes a spike *lean* — a crown at 1 of 5 is
 * one steep segment up and a long shallow slide back down, and no two lean alike.
 */
interface Spike {
  /** Ring vertices this spike owns. The spans sum to RING_POINTS. */
  span: number
  /** Vertex within the span carrying the crown; 1 ≤ rise < span. */
  rise: number
  /** Crown length as a fraction of BOLT_REACH, before the viewBox clamp. */
  reach: number
  /** Radius the spike starts from — the notch between it and the one before. */
  valley: number
}

/** Radius the body sits at when a spike neither reaches out nor cuts in. */
const BOLT_BODY = 0.8

/** How far past the body a full-length spike aims, in base-ellipse units. */
const BOLT_REACH = 0.85

/**
 * View units kept between a vertex and the viewBox edge — breathing room so a clamped
 * crown's ink does not sit flush against the panel border.
 */
const BOX_MARGIN = 1.5

/**
 * The perimeter, clockwise from the top of the ellipse (ring index 0), traced from
 * `public/comic-book/jagged bubble.png` — fifteen spikes over 64 vertices, in the
 * order the reference draws them, rotated so its notch nearest the top lands on ring
 * index 0. `reach` and `valley` are the traced radii, linearly remapped so the
 * deepest notch sits at 0.67 (above the 0.65 lettering floor) and the longest spike
 * at full reach.
 *
 * The character the trace preserves, which is what the hand-authored tables missed:
 * one spike (`reach: 1`, aimed lower-left like the reference's dominant point) is
 * nearly twice the length of the median, a run of genuinely stubby spikes sits on the
 * lower arc (reach ≤ 0.3), and the deepest notches neighbour the longest points.
 */
const SPIKES: Spike[] = [
  { span: 4, rise: 1, reach: 0.48, valley: 0.74 }, // top, leaning hard left
  { span: 4, rise: 2, reach: 0.44, valley: 0.76 },
  { span: 5, rise: 2, reach: 0.56, valley: 0.8 }, // up-right
  { span: 4, rise: 2, reach: 0.61, valley: 0.84 }, // right flank (box-clamped)
  { span: 2, rise: 1, reach: 0.36, valley: 0.87 },
  { span: 5, rise: 2, reach: 0.55, valley: 0.86 }, // down-right
  { span: 5, rise: 2, reach: 0.25, valley: 0.73 },
  { span: 5, rise: 3, reach: 0.28, valley: 0.67 }, // bottom stub after the deepest notch
  { span: 4, rise: 2, reach: 1, valley: 0.72 }, // lower-left, the dominant point
  { span: 5, rise: 2, reach: 0.42, valley: 0.81 },
  { span: 5, rise: 2, reach: 0.51, valley: 0.82 },
  { span: 3, rise: 2, reach: 0.4, valley: 0.83 }, // left flank
  { span: 5, rise: 3, reach: 0.54, valley: 0.81 }, // up-left
  { span: 5, rise: 3, reach: 0.3, valley: 0.72 },
  { span: 3, rise: 1, reach: 0.17, valley: 0.72 }, // top-left stub
]

/** How many spikes the outline carries — exported so a test can pin the count. */
export const BOLT_SPIKES = SPIKES.length

/** Ring index each spike starts at: the running sum of the spans before it. */
const SPIKE_STARTS: number[] = SPIKES.map((_, k) =>
  SPIKES.slice(0, k).reduce((n, s) => n + s.span, 0),
)

/** Ring index → the spike that owns it. */
const SPIKE_AT: number[] = SPIKES.flatMap((s, k) => Array<number>(s.span).fill(k))

/**
 * Largest radius a vertex at `theta` can take and stay inside BUBBLE_VIEW. The box is
 * padded below the ellipse for the tail and tight at the flanks, so this is not one
 * number: a spike aimed sideways has ~0.37 of headroom past the body while one aimed
 * down has more than the design ever asks for. Feeding that back into the crown is
 * deliberate — it is what makes the flank spikes shorter than the diagonal ones
 * without the table having to encode the box's shape by hand.
 */
function boxCap(theta: number): number {
  const dx = Math.cos(theta)
  const dy = Math.sin(theta)
  const room = (avail: number, radius: number, component: number): number =>
    Math.abs(component) < 1e-9 ? Infinity : (avail - BOX_MARGIN) / (radius * Math.abs(component))
  return Math.min(
    room(dx > 0 ? BUBBLE_VIEW.w - ELLIPSE.cx : ELLIPSE.cx, ELLIPSE.rx, dx),
    room(dy > 0 ? BUBBLE_VIEW.h - ELLIPSE.cy : ELLIPSE.cy, ELLIPSE.ry, dy),
  )
}

/** Per-vertex ceiling, resolved once: it depends only on the ring and the box. */
const CAPS: number[] = Array.from({ length: RING_POINTS }, (_, i) => boxCap(ringTheta(i)))

/**
 * Crown radius of each spike, resolved once. Clamping here rather than only at the end
 * matters: the falling edge aims at the point that is actually drawn, so the two
 * segments meet at the crown instead of at an imaginary tip beyond the box.
 */
const CROWNS: number[] = SPIKES.map((s, k) =>
  Math.min(CAPS[SPIKE_STARTS[k] + s.rise], BOLT_BODY + s.reach * BOLT_REACH),
)

/**
 * A ring vertex as a point in the space where the base ellipse is the unit circle.
 * The map from here to BUBBLE_VIEW is affine (scale by rx/ry, then translate), and
 * affine maps preserve straight lines — so a chord computed in this space renders as
 * a dead-straight edge on screen.
 */
function ringPointN(i: number, m: number): [number, number] {
  const theta = ringTheta(i)
  return [m * Math.cos(theta), m * Math.sin(theta)]
}

/**
 * Radius of ring vertex `i` in base-ellipse units: 1 is on the ellipse, below cuts in.
 *
 * A corner vertex (valley or crown) takes its authored radius; every other vertex
 * takes the radius at which its ray crosses the **straight chord** between the two
 * corners around it. Interpolating the radius itself — the previous implementation —
 * sweeps a linearly-growing radius across changing angles, which traces a shallow
 * spiral arc: every edge bowed, and the outline read as soft against the reference's
 * ruler-straight lines.
 *
 * The final `min` is the box guard, and it is what makes "no spike leaves the
 * viewBox" structural rather than lucky. It cannot break an edge's straightness: the
 * inset box is convex and both corners are clamped inside it, so the chord between
 * them never crosses the cap.
 */
export function boltMod(i: number): number {
  const k = SPIKE_AT[i]
  const s = SPIKES[k]
  const j = i - SPIKE_STARTS[k]
  if (j === 0) return Math.min(CAPS[i], s.valley)
  if (j === s.rise) return Math.min(CAPS[i], CROWNS[k])
  const climbing = j < s.rise
  // The falling edge aims at the *next* spike's valley, so the ring closes seamlessly.
  const a = climbing ? SPIKE_STARTS[k] : SPIKE_STARTS[k] + s.rise
  const b = climbing ? SPIKE_STARTS[k] + s.rise : SPIKE_STARTS[k] + s.span
  const [ax, ay] = ringPointN(a, climbing ? s.valley : CROWNS[k])
  const [bx, by] = ringPointN(b, climbing ? CROWNS[k] : SPIKES[(k + 1) % SPIKES.length].valley)
  const theta = ringTheta(i)
  // Ray r·(cos θ, sin θ) meets the line A→B where r·(d × (B−A)) = A × B.
  const r =
    (ax * by - ay * bx) /
    (Math.cos(theta) * (by - ay) - Math.sin(theta) * (bx - ax))
  return Math.min(CAPS[i], r)
}
