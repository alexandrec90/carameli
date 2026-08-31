// Connector "tubes" between linked speech bubbles — the thin white corridor comic
// books use to join two balloons belonging to one speaker. Pure geometry: the
// renderer hands over two on-screen bubble boxes and paints what comes back.
//
// How the seam disappears: the corridor is deliberately sunk INTO both bubbles
// (PENETRATION) and the tube layer paints ABOVE them, so each tube's white fill
// erases the slice of bubble outline it covers and only the two side rails get
// stroked. There is no path union anywhere — the weld is purely paint order, which
// is also why the tube layer's z-index in comic-book.css is load-bearing.

import { BUBBLE_ELLIPSE_N } from './bubbleBox'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface TubeGeometry {
  /** Closed corridor to fill white. Paint before the rails. */
  fill: string
  /** The two open side rails to stroke black. */
  rails: [string, string]
}

/** Fraction of the centre→edge distance the corridor sinks into each bubble. */
const PENETRATION = 0.18
/** Cap on that sink depth in px, so a huge bubble doesn't swallow the corridor. */
const PENETRATION_MAX = 16
/** Corridor half-width as a fraction of the narrower bubble's width. */
const HALF_WIDTH = 0.045
const HALF_WIDTH_MIN = 5
const HALF_WIDTH_MAX = 16
/** Sideways bow of the corridor, as a fraction of the clear gap it spans. */
const BOW = 0.1
/** Below this clear gap the bubbles already touch and no tube is drawn. */
const MIN_GAP = 6

/** Centre of the bubble's base ellipse within its box. */
function centre(r: Rect): [number, number] {
  return [r.x + r.w * BUBBLE_ELLIPSE_N.cx, r.y + r.h * BUBBLE_ELLIPSE_N.cy]
}

/** Distance from the ellipse centre to its edge along the unit vector (ux, uy). */
function edgeDistance(r: Rect, ux: number, uy: number): number {
  const rx = r.w * BUBBLE_ELLIPSE_N.rx
  const ry = r.h * BUBBLE_ELLIPSE_N.ry
  return 1 / Math.hypot(ux / rx, uy / ry)
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Build the corridor joining bubbles `a` and `b`, or null when there is nothing to
 * join: coincident centres, or bubbles so close they already overlap (a tube
 * shorter than its own width reads as a smudge, so it is better omitted).
 *
 * Bubble rotation is ignored. `rotate` is clamped to ±30° and the base ellipse is
 * close to circular, so aiming at the unrotated ellipse moves each mouth by a
 * couple of pixels — invisible once the mouth is sunk inside the bubble anyway.
 */
export function tubeBetween(a: Rect, b: Rect): TubeGeometry | null {
  const [ax, ay] = centre(a)
  const [bx, by] = centre(b)
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 1) return null

  const ux = dx / len
  const uy = dy / len
  const ea = edgeDistance(a, ux, uy)
  const eb = edgeDistance(b, ux, uy)
  const gap = len - ea - eb
  if (gap < MIN_GAP) return null

  const penA = Math.min(ea * PENETRATION, PENETRATION_MAX)
  const penB = Math.min(eb * PENETRATION, PENETRATION_MAX)
  // The mouths, sunk inside each bubble so the fill covers its outline there.
  const m1x = ax + ux * (ea - penA)
  const m1y = ay + uy * (ea - penA)
  const m2x = bx - ux * (eb - penB)
  const m2y = by - uy * (eb - penB)

  const hw = clamp(Math.min(a.w, b.w) * HALF_WIDTH, HALF_WIDTH_MIN, HALF_WIDTH_MAX)
  // Perpendicular to travel, and also the bow direction — the corridor always
  // curves to the same side of the a→b run, so a pair's tube never flips about.
  const nx = -uy
  const ny = ux
  const bow = gap * BOW
  const cx = (m1x + m2x) / 2 + nx * bow
  const cy = (m1y + m2y) / 2 + ny * bow

  const p = (x: number, y: number): string => `${r2(x)} ${r2(y)}`
  const rail = (s: number): string =>
    `M ${p(m1x + nx * hw * s, m1y + ny * hw * s)}` +
    ` Q ${p(cx + nx * hw * s, cy + ny * hw * s)}` +
    ` ${p(m2x + nx * hw * s, m2y + ny * hw * s)}`

  // Down one rail, straight across inside bubble b, back up the other. The two
  // cross-segments sit inside the bubbles and are never stroked, which is what
  // leaves the corridor open at both ends.
  const fill =
    `M ${p(m1x + nx * hw, m1y + ny * hw)}` +
    ` Q ${p(cx + nx * hw, cy + ny * hw)} ${p(m2x + nx * hw, m2y + ny * hw)}` +
    ` L ${p(m2x - nx * hw, m2y - ny * hw)}` +
    ` Q ${p(cx - nx * hw, cy - ny * hw)} ${p(m1x - nx * hw, m1y - ny * hw)} Z`

  return { fill, rails: [rail(1), rail(-1)] }
}

/**
 * Distinct bubble pairs to join, from each bubble's `linkTo`. A link is symmetric:
 * declaring it on either end draws one tube, and a mutual A→B / B→A declaration
 * still draws one — otherwise every rail would be stroked twice, which shows up as
 * a subtly heavier line. Self-links and out-of-range indices are dropped.
 *
 * **So is a link between two panels.** A tube means one speaker's line continuing
 * across two balloons, and the two halves only appear together while their panel is
 * hovered — a cross-panel tube would spend most of its life anchored to a bubble that
 * is not on screen. The editor never offers one, so a link that gets here is stale
 * config (a bubble moved panels by hand), and dropping it beats drawing a rail into
 * empty space.
 *
 * **So is a link with either end in a bubble chain.** `linkTo` says two things now — draw
 * a tube between these balloons, *and* these balloons are one column — and `chain` is
 * which of the two the author meant: a chain slot is a window a transcript scrolls through
 * rather than a fixed balloon (see bubbleChain.ts), so a tube welded to one would join a
 * different sentence every time the reader turned the wheel. That is why ticking the chain
 * box takes a linked pair's tube away and unticking it gives it back, from the one field.
 * `chain` is optional here only so a caller with no chains to speak of — a test, or a
 * synthetic pair — need not invent the field.
 */
export function linkedPairs(
  bubbles: { panel: number; linkTo: number | null; chain?: string }[],
): [number, number][] {
  const seen = new Set<string>()
  const pairs: [number, number][] = []
  bubbles.forEach((b, i) => {
    const j = b.linkTo
    if (j == null || j === i || j < 0 || j >= bubbles.length) return
    if (bubbles[j].panel !== b.panel) return
    if (b.chain || bubbles[j].chain) return
    const lo = Math.min(i, j)
    const hi = Math.max(i, j)
    const key = `${lo}-${hi}`
    if (seen.has(key)) return
    seen.add(key)
    pairs.push([lo, hi])
  })
  return pairs
}

/**
 * Whether bubble `index` is revealed, given the panel under the pointer. A bubble
 * shows when its own panel is hovered — every bubble on that panel does, so a linked
 * pair arrives and leaves together and no tube is ever left anchored to a hidden end —
 * or whenever the editor is up and every bubble has to be selectable.
 *
 * A balloon belonging to a call layout is exempt: it is on screen because the telephone
 * is in use, and a reader watching a call should not have to keep the pointer on the
 * panel to read the words. Whether it is drawn at all was already decided upstream by
 * the layout the panel is showing (see callSceneRoles.inRoles), so there is nothing for
 * hover to add. Before the scene was rebuilt out of ordinary pictures and balloons it
 * drew its own transcript unconditionally, and this is where that behaviour now lives.
 */
export function isBubbleRevealed(
  bubbles: { panel: number; call?: string }[],
  hovered: number | null,
  editorActive: boolean,
  index: number,
): boolean {
  if (editorActive) return true
  const bubble = bubbles[index]
  if (!bubble) return false
  if (bubble.call !== undefined) return true
  if (hovered === null) return false
  return bubble.panel === hovered
}
