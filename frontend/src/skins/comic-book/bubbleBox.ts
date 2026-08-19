// The box every bubble outline is authored in: the shared viewBox, the base ellipse
// inside it, and the two things that hang off that ellipse — the tail tip for a chosen
// direction, and the thought-bubble puffs that trail the same way. Pure, no DOM, ships
// in prod.
//
// Only the tail's own direction decides where it lands, so a tail pointing up or
// sideways runs past the viewBox edge: the box is padded below the ellipse and barely
// anywhere else, because it was drawn when the tail could only hang bottom-left.
// Ink outside the viewBox still renders — `.cb-panel-bubble-svg` sets
// `overflow: visible`, which is what already lets a `lightning` spike cross the edge —
// so the reach below is honoured in every direction rather than clamped to a box that
// happens to be tight on three sides. Growing the box instead would move every bubble
// on the page, since placement is measured against the box, not the balloon.

/** SVG user-space box every bubble path is authored in. */
export const BUBBLE_VIEW = { w: 200, h: 150 } as const

/** Base ellipse, in BUBBLE_VIEW units. Sized to leave room for a tail below it. */
export const ELLIPSE = { cx: 100, cy: 58, rx: 84, ry: 44 } as const

/**
 * Vertices in the outline ring. It lives here rather than with the shapes because it
 * is a property of *this* sampling of the ellipse: every type walks the same ring, so
 * any two types interpolate vertex-for-vertex (see bubbleShape.ts).
 */
export const RING_POINTS = 64

/** Rendered bubble height as a fraction of its width — fixed by BUBBLE_VIEW. */
export const BUBBLE_ASPECT = BUBBLE_VIEW.h / BUBBLE_VIEW.w

/**
 * The base ellipse as fractions of the rendered bubble box. A connector tube aims at
 * this rather than at the box: the box corners are empty, so a tube pointed at them
 * would visibly miss the bubble.
 */
export const BUBBLE_ELLIPSE_N = {
  cx: ELLIPSE.cx / BUBBLE_VIEW.w,
  cy: ELLIPSE.cy / BUBBLE_VIEW.h,
  rx: ELLIPSE.rx / BUBBLE_VIEW.w,
  ry: ELLIPSE.ry / BUBBLE_VIEW.h,
} as const

const TAU = Math.PI * 2
/** Unit component of a diagonal direction. */
const D = Math.SQRT1_2

/**
 * Where a bubble's tail points. `none` is a real member rather than a null: it is one
 * option in the editor's dropdown like any other, and a bubble with no tail is a
 * normal thing to want (a caption, or a balloon whose speaker is off-panel).
 *
 * Its zero vector is never used — {@link tailRingIndex} returns -1 for `none`, so no
 * vertex is pulled out and no puff is placed — but keeping the record uniform lets the
 * dropdown map over it without a special case.
 */
export const TAIL_DIRS = {
  none: { label: 'No tail', ux: 0, uy: 0 },
  'down-left': { label: 'Down left', ux: -D, uy: D },
  down: { label: 'Down', ux: 0, uy: 1 },
  'down-right': { label: 'Down right', ux: D, uy: D },
  left: { label: 'Left', ux: -1, uy: 0 },
  right: { label: 'Right', ux: 1, uy: 0 },
  'up-left': { label: 'Up left', ux: -D, uy: -D },
  up: { label: 'Up', ux: 0, uy: -1 },
  'up-right': { label: 'Up right', ux: D, uy: -D },
} as const

export type TailDir = keyof typeof TAIL_DIRS

/** All tail directions in display order — for the editor dropdown. */
export const TAIL_DIR_KEYS = Object.keys(TAIL_DIRS) as TailDir[]

/**
 * How far past the ellipse edge a fully-extended tail reaches, in view units. Set to
 * what the old fixed bottom-left tail reached, so a `down-left` tail is the shape it
 * has always been and every other direction is the same tail, turned.
 */
const TAIL_REACH = 50

/**
 * Trailing puffs of a thought bubble, as distance past the ellipse edge and radius.
 * Detached from the ring, so they cannot join the morph — they fade instead (see
 * `puffOpacity`), which reads fine because they are small and the ring does the
 * visible work.
 */
const PUFF_STOPS = [
  { at: 26, r: 7 },
  { at: 41, r: 4.4 },
  { at: 52, r: 2.8 },
] as const

export interface Puff {
  cx: number
  cy: number
  r: number
}

/** Distance from the ellipse centre to its own edge along the unit vector (ux, uy). */
function edgeDistance(ux: number, uy: number): number {
  return 1 / Math.hypot(ux / ELLIPSE.rx, uy / ELLIPSE.ry)
}

/** A point `extra` units past the ellipse edge along the unit vector (ux, uy). */
function pointOutside(ux: number, uy: number, extra: number): [number, number] {
  const d = edgeDistance(ux, uy) + extra
  return [ELLIPSE.cx + ux * d, ELLIPSE.cy + uy * d]
}

/**
 * Ring index pulled out to form the tail — the vertex nearest `dir`, or -1 for `none`.
 * Its two neighbours stay put and become the tail's roots, so the tail is a slender
 * triangle rather than a separate shape, and "grow a tail" morphs like anything else:
 * the vertex simply travels back onto the ring.
 */
export function tailRingIndex(dir: TailDir): number {
  const { ux, uy } = TAIL_DIRS[dir]
  if (ux === 0 && uy === 0) return -1
  // Ring index 0 sits at the top of the ellipse (angle -π/2) and runs clockwise.
  const i = Math.round(((Math.atan2(uy, ux) + Math.PI / 2) / TAU) * RING_POINTS)
  return ((i % RING_POINTS) + RING_POINTS) % RING_POINTS
}

/** Where the tail vertex reaches when fully extended, in BUBBLE_VIEW units. */
export function tailTip(dir: TailDir): [number, number] {
  const { ux, uy } = TAIL_DIRS[dir]
  return pointOutside(ux, uy, TAIL_REACH)
}

/** Thought-bubble puffs trailing along `dir`; empty when there is no tail. */
export function cloudPuffs(dir: TailDir): Puff[] {
  const { ux, uy } = TAIL_DIRS[dir]
  if (ux === 0 && uy === 0) return []
  return PUFF_STOPS.map(({ at, r }) => {
    const [cx, cy] = pointOutside(ux, uy, at)
    return { cx, cy, r }
  })
}
