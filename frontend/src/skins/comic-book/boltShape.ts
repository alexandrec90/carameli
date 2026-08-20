// Action-bubble geometry: the 1960s pop-art impact burst. Pure, no DOM, ships in prod.
//
// This is deliberately **not** a modulated ellipse. Any radial function of the angle —
// a cosine, or a triangle wave with jittered amplitude on top — produces spikes that
// are evenly spaced and broadly one length, and that reads as a *sun* however much
// noise is piled onto it. Adding jitter to a smooth burst was the previous attempt and
// it is why the outline still read as soft and organic.
//
// A burst reads as a burst because its perimeter is an **authored sequence of
// alternating peaks and notches** whose spacing, lean and length all differ: a handful
// of points project dramatically, most are stubs, and the notches between them cut
// deep enough that the silhouette is sawtooth rather than scalloped. So the spikes are
// a table, not a formula. Each entry owns a run of consecutive ring vertices and is
// walked as two straight segments — valley → crown, then crown → the *next* spike's
// valley — so every vertex is either a corner or a point on a straight edge, and
// nothing is ever interpolated through a curve.
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
const BOLT_REACH = 0.62

/**
 * View units kept between a vertex and the viewBox edge. It has to exceed the
 * roughness a crown can pick up (ROUGHNESS / 2 × ELLIPSE.rx ≈ 0.84), or the guard in
 * {@link boltMod} would let a jittered crown out of the box the ring test pins it to.
 */
const BOX_MARGIN = 1.5

/** Peak-to-peak wobble added per vertex — hand-drawn ink, not a shape change. */
const ROUGHNESS = 0.02

/**
 * The perimeter, clockwise from the top of the ellipse (ring index 0). Nineteen
 * spikes over 64 vertices: enough for the sawtooth to read at a glance, few enough
 * that each one still gets two or more vertices and stays a triangle.
 *
 * Read the columns as the design brief: the spans are irregular so the spacing is
 * never periodic, `reach` alternates a stub against a long point rather than easing
 * between them, and the deepest valleys sit next to the longest spikes so the notch
 * and the point amplify each other. The five entries at reach ≥ 0.9 are the ones that
 * carry the silhouette — top, up-right, both flanks, the bottom, and the long
 * lower-left point.
 *
 * One span is tuned rather than authored: the spans before the right flank are sized
 * so no spike *starts* on ring index 16, the horizontal axis. A spike starts at its
 * valley, and the lettering box reaches almost to the ellipse's flanks, so a notch
 * placed exactly there is the one position where the interior reads as pinched.
 */
const SPIKES: Spike[] = [
  { span: 4, rise: 2, reach: 0.95, valley: 0.8 }, // top
  { span: 3, rise: 1, reach: 0.3, valley: 0.74 },
  { span: 2, rise: 1, reach: 1, valley: 0.83 }, // up-right, long
  { span: 4, rise: 3, reach: 0.45, valley: 0.72 },
  { span: 4, rise: 2, reach: 0.72, valley: 0.85 },
  { span: 3, rise: 1, reach: 1, valley: 0.76 }, // right flank, long
  { span: 5, rise: 2, reach: 0.34, valley: 0.88 },
  { span: 3, rise: 1, reach: 0.86, valley: 0.75 },
  { span: 4, rise: 2, reach: 0.52, valley: 0.82 },
  { span: 2, rise: 1, reach: 0.9, valley: 0.71 }, // bottom, long
  { span: 4, rise: 3, reach: 0.28, valley: 0.84 },
  { span: 5, rise: 3, reach: 1, valley: 0.73 }, // lower-left, longest
  { span: 3, rise: 1, reach: 0.4, valley: 0.87 },
  { span: 4, rise: 2, reach: 1, valley: 0.78 }, // left flank, long
  { span: 2, rise: 1, reach: 0.36, valley: 0.72 },
  { span: 3, rise: 2, reach: 0.66, valley: 0.86 },
  { span: 4, rise: 1, reach: 0.94, valley: 0.74 }, // up-left, long
  { span: 3, rise: 2, reach: 0.24, valley: 0.83 },
  { span: 2, rise: 1, reach: 0.58, valley: 0.8 },
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
 * Deterministic [0, 1) hash. The roughness has to be stable across renders — the
 * morph loop resamples the ring, and a `Math.random` would make the outline crawl —
 * and stable geometry is also what makes it assertable in a test.
 */
function jitter(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

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
 * Radius of ring vertex `i` in base-ellipse units: 1 is on the ellipse, below cuts in.
 *
 * Every vertex sits on one of its spike's two straight segments. The final `min` is
 * the box guard — it only bites on a crown the roughness nudged past its ceiling, and
 * it is what makes "no spike leaves the viewBox" structural rather than lucky.
 */
export function boltMod(i: number): number {
  const k = SPIKE_AT[i]
  const s = SPIKES[k]
  const j = i - SPIKE_STARTS[k]
  const climbing = j <= s.rise
  const from = climbing ? s.valley : CROWNS[k]
  // The falling edge aims at the *next* spike's valley, so the ring closes seamlessly.
  const to = climbing ? CROWNS[k] : SPIKES[(k + 1) % SPIKES.length].valley
  const t = climbing ? j / s.rise : (j - s.rise) / (s.span - s.rise)
  return Math.min(CAPS[i], from + (to - from) * t + ROUGHNESS * (jitter(i) - 0.5))
}
