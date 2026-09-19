import { BUBBLE_ASPECT, BUBBLE_ELLIPSE_N } from './bubbleBox'
import type { FitMetrics } from './bubbleFit'
import type { BubbleTransform } from './editor/types'

// Where a conversation's balloons go, once each one knows its size. Pure geometry in the
// panel box's % units, used by `conversationRows` (chainRows.ts) and nothing measured.
//
// The rule this replaces was two ruled columns: every row of a side hung from the same
// edge and sat wholly above the row below it, whichever side that was. A conversation of
// short messages then read as two ladders with a corridor of nothing between them. Two
// changes make it read as a thread instead:
//
// - **Rows interleave where they can, and height is time.** A row is placed by what it
//   would actually collide with: it must clear the ellipse of every row *beside* which it
//   would overlap horizontally, and beyond that it sinks alongside the newer rows until
//   its bottom is a small step above the bottom of every one of them —
//   {@link CHAIN_ORDER_STEP} — so a reply on the other side tucks in next to the message
//   it answers rather than a full balloon above it, and the bottoms of the balloons still
//   read in transcript order: whichever column a balloon is in, the one said just before
//   it ends a little higher up the panel, the one said just after a little lower. A long
//   message that fills its column still stacks, because it overlaps everything. That is
//   what lets the two columns be drawn *close* — overlapping, even — without any two
//   balloons overlapping, and without two balloons on opposite sides sitting level, which
//   would leave nothing to say which was said first.
// - **Each speaker's rows zig-zag.** A row alternates between its column's outer edge
//   and a lean inward ({@link CHAIN_ZIGZAG}), by its ordinal among that speaker's
//   messages in the whole transcript — not its row on screen, or every balloon would
//   jump sideways at each turn of the wheel. The two sides alternate in opposite phase,
//   so a back-and-forth snakes across the panel instead of both columns leaning at once.

/** Gap between one row's ellipse and the next it must clear, in % of the box height. */
export const CHAIN_ROW_GAP = 1.5

/**
 * Horizontal clearance, in % of the box width, within which two rows count as side by
 * side rather than beside each other. Rows nearer than this stack; further apart, they
 * may interleave.
 */
export const CHAIN_COL_GAP = 2

/**
 * The least distance an older row's ellipse bottom sits above a newer row's, as a fraction
 * of the newer row's ellipse height. It is the offset that says which of two balloons
 * beside each other was said first: 0 would let them sit level and say nothing, 1 would
 * put every row wholly above the last (the old ruled table). A quarter is enough to read
 * and leaves a short reply tucked in alongside most of the message it answers.
 */
export const CHAIN_ORDER_STEP = 0.25

/**
 * How far into its column's slack a leaning row moves, as a fraction of that slack — the
 * room between the row's width and its column's. 1 would put a short balloon against the
 * column's inner edge; a little less keeps the lean a lean.
 */
export const CHAIN_ZIGZAG = 0.75

/** What the layout resolves against: the fit's px, plus the box's own aspect. */
export interface ChainMetrics extends FitMetrics {
  /** The panel box's width / height, which turns a width % into a height %. */
  aspect: number
}

/** A row once it is on the panel: its balloon, and how much taller than its aspect. */
export interface PlacedRow {
  bubble: Pick<BubbleTransform, 'top' | 'right' | 'width'>
  stretch: number
}

/**
 * A balloon's height in % of the panel box *height*, for one `width`% wide, drawn
 * `stretch` times taller than its aspect.
 *
 * The box is its width times {@link BUBBLE_ASPECT} — the outline SVG carries a viewBox
 * and the DOM height resolves from it — so converting that to a share of the panel needs
 * the panel's own aspect ratio (`width / height`). That ratio is a property of the grid,
 * not of the window: the page frame holds a fixed aspect per window shape, so the caller
 * reads it off the panel box it drew and nothing is measured back from the DOM.
 */
export function bubbleHeightPct(width: number, panelAspect: number, stretch = 1): number {
  return width * BUBBLE_ASPECT * stretch * panelAspect
}

/** An axis-aligned box in panel %: `x` across the width, `y` down the height. */
export interface PctBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** The visible ellipse of a placed row — its ink, not its tail-padded box. */
export function rowEllipse(row: PlacedRow, panelAspect: number): PctBox {
  const { top, right, width } = row.bubble
  const h = bubbleHeightPct(width, panelAspect, row.stretch)
  const left = 100 - right - width
  return {
    x1: left + width * (BUBBLE_ELLIPSE_N.cx - BUBBLE_ELLIPSE_N.rx),
    x2: left + width * (BUBBLE_ELLIPSE_N.cx + BUBBLE_ELLIPSE_N.rx),
    y1: top + h * (BUBBLE_ELLIPSE_N.cy - BUBBLE_ELLIPSE_N.ry),
    y2: top + h * (BUBBLE_ELLIPSE_N.cy + BUBBLE_ELLIPSE_N.ry),
  }
}

/**
 * How far inward from its column's outer edge the `ordinal`-th message of a side leans,
 * given `slack` — the column's width less the balloon's. The sender's odd messages lean
 * and the recipient's even ones do, so the thread snakes rather than both sides leaning
 * together; a balloon filling its column has no slack and leans nowhere.
 */
export function zigzagShift(ordinal: number, out: boolean, slack: number): number {
  const leans = (ordinal + (out ? 1 : 0)) % 2 === 1
  return leans ? Math.max(0, slack) * CHAIN_ZIGZAG : 0
}

/**
 * Place an upper row by the visible ellipse of the one below it, wholly above it. The
 * ruled-table rule, kept for the editor's frame (chainFrame.ts), which draws the tallest
 * table a row count can make and so wants no interleaving.
 */
export function chainRowTop(
  below: Pick<BubbleTransform, 'top' | 'width'>,
  upperWidth: number,
  panelAspect: number,
): number {
  const lowerHeight = bubbleHeightPct(below.width, panelAspect)
  const upperHeight = bubbleHeightPct(upperWidth, panelAspect)
  const ellipseTop = BUBBLE_ELLIPSE_N.cy - BUBBLE_ELLIPSE_N.ry
  const ellipseBottom = BUBBLE_ELLIPSE_N.cy + BUBBLE_ELLIPSE_N.ry
  return below.top + lowerHeight * ellipseTop - upperHeight * ellipseBottom - CHAIN_ROW_GAP
}

/**
 * The `top` of the next row up, given every row already placed — all of them newer than
 * it, bottom first — and the row's own width, side edge and stretch.
 *
 * Its ellipse's bottom goes as low as two limits allow. Against *every* placed row it
 * stops {@link CHAIN_ORDER_STEP} of that row's ellipse above that row's bottom, so that
 * the bottoms of the balloons run in transcript order however the columns interleave; and
 * it clears, by {@link CHAIN_ROW_GAP}, every placed row whose ellipse it would overlap
 * horizontally — within {@link CHAIN_COL_GAP} of touching counts as overlapping. Directly
 * over the row below it the second limit binds and the row stacks exactly as
 * {@link chainRowTop} stacks it; beside it, the first does, and the row tucks in.
 *
 * The order limit is taken against every row rather than the one just below because the
 * two at the foot are placed by the author, not by this rule (`placeRows`, chainRows.ts),
 * and nothing says which of them ends lower.
 */
export function stackedTop(
  placed: readonly PlacedRow[],
  next: Pick<BubbleTransform, 'right' | 'width'> & { stretch: number },
  panelAspect: number,
): number {
  if (placed.length === 0) throw new Error('stackedTop needs a row to stack on')
  let bottom = Infinity
  const left = 100 - next.right - next.width
  const x1 = left + next.width * (BUBBLE_ELLIPSE_N.cx - BUBBLE_ELLIPSE_N.rx) - CHAIN_COL_GAP
  const x2 = left + next.width * (BUBBLE_ELLIPSE_N.cx + BUBBLE_ELLIPSE_N.rx) + CHAIN_COL_GAP
  for (const row of placed) {
    const e = rowEllipse(row, panelAspect)
    bottom = Math.min(bottom, e.y2 - (e.y2 - e.y1) * CHAIN_ORDER_STEP)
    if (e.x2 > x1 && e.x1 < x2) bottom = Math.min(bottom, e.y1 - CHAIN_ROW_GAP)
  }
  const h = bubbleHeightPct(next.width, panelAspect, next.stretch)
  return bottom - h * (BUBBLE_ELLIPSE_N.cy + BUBBLE_ELLIPSE_N.ry)
}

/** Whether the straight line from `p` to `q` passes through `box` (Liang–Barsky). */
export function segmentCrossesBox(p: [number, number], q: [number, number], box: PctBox): boolean {
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  let t0 = 0
  let t1 = 1
  const edges: [number, number][] = [
    [-dx, p[0] - box.x1],
    [dx, box.x2 - p[0]],
    [-dy, p[1] - box.y1],
    [dy, box.y2 - p[1]],
  ]
  for (const [den, num] of edges) {
    if (den === 0) {
      if (num < 0) return false
      continue
    }
    const t = num / den
    if (den < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return false
  }
  return true
}

/**
 * Whether a connector tube between rows `a` and `b` would cross a third row's ink. A
 * tube's white fill erases whatever outline it paints over — that is how it welds to its
 * two ends — so one drawn through a balloon that is not either end takes a bite out of
 * it. Interleaving is what makes this possible: the other speaker's reply can now sit
 * between two of one speaker's balloons.
 */
export function tubeBlocked(
  a: PlacedRow,
  b: PlacedRow,
  others: readonly PlacedRow[],
  panelAspect: number,
): boolean {
  const centre = (row: PlacedRow): [number, number] => {
    const e = rowEllipse(row, panelAspect)
    return [(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2]
  }
  const p = centre(a)
  const q = centre(b)
  return others.some(row => row !== a && row !== b && segmentCrossesBox(p, q, rowEllipse(row, panelAspect)))
}
