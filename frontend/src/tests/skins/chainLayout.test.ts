import { describe, expect, it } from 'vitest'

import { BUBBLE_ASPECT, BUBBLE_ELLIPSE_N } from '../../skins/comic-book/bubbleBox'
import {
  CHAIN_COL_GAP,
  CHAIN_INTERLEAVE,
  CHAIN_ROW_GAP,
  CHAIN_ZIGZAG,
  bubbleHeightPct,
  chainRowTop,
  rowEllipse,
  segmentCrossesBox,
  stackedTop,
  tubeBlocked,
  zigzagShift,
} from '../../skins/comic-book/chainLayout'
import type { PlacedRow } from '../../skins/comic-book/chainLayout'

// Where a conversation's rows go once they know their size: the collision-aware stack that
// lets a reply tuck in beside the message it answers, and the lean that zig-zags a
// speaker's balloons across their column.

/** A placed row: `top`/`right`/`width` in panel %, drawn `stretch` times its aspect. */
const row = (top: number, right: number, width: number, stretch = 1): PlacedRow => ({
  bubble: { top, right, width },
  stretch,
})

const ellipseTopN = BUBBLE_ELLIPSE_N.cy - BUBBLE_ELLIPSE_N.ry
const ellipseBottomN = BUBBLE_ELLIPSE_N.cy + BUBBLE_ELLIPSE_N.ry

describe('bubbleHeightPct', () => {
  it('is the balloon’s own aspect, rescaled by the panel’s', () => {
    expect(bubbleHeightPct(40, 1)).toBeCloseTo(40 * BUBBLE_ASPECT, 6)
    // A panel twice as wide as it is tall: the same width % is twice the height %.
    expect(bubbleHeightPct(40, 2)).toBeCloseTo(80 * BUBBLE_ASPECT, 6)
  })

  it('grows with the stretch a fitted message asks for', () => {
    expect(bubbleHeightPct(40, 1, 1.5)).toBeCloseTo(60 * BUBBLE_ASPECT, 6)
  })
})

describe('rowEllipse', () => {
  it('is the base ellipse’s box inside the balloon’s, not the tail-padded box', () => {
    const e = rowEllipse(row(60, 5, 40), 1)
    // Left edge at 55; the ellipse sits inset from both sides of the 40-wide box.
    expect(e.x1).toBeCloseTo(55 + 40 * (BUBBLE_ELLIPSE_N.cx - BUBBLE_ELLIPSE_N.rx), 6)
    expect(e.x2).toBeCloseTo(55 + 40 * (BUBBLE_ELLIPSE_N.cx + BUBBLE_ELLIPSE_N.rx), 6)
    const h = bubbleHeightPct(40, 1)
    expect(e.y1).toBeCloseTo(60 + h * ellipseTopN, 6)
    expect(e.y2).toBeCloseTo(60 + h * ellipseBottomN, 6)
  })

  it('is taller for a stretched row, and no wider', () => {
    const plain = rowEllipse(row(60, 5, 40), 1)
    const tall = rowEllipse(row(60, 5, 40, 2), 1)
    expect(tall.x1).toBe(plain.x1)
    expect(tall.x2).toBe(plain.x2)
    expect(tall.y2 - tall.y1).toBeCloseTo(2 * (plain.y2 - plain.y1), 6)
  })
})

describe('zigzagShift', () => {
  it('leans a speaker’s every other message inward, by the zig-zag share of the slack', () => {
    expect(zigzagShift(0, false, 20)).toBe(0)
    expect(zigzagShift(1, false, 20)).toBeCloseTo(20 * CHAIN_ZIGZAG, 6)
    expect(zigzagShift(2, false, 20)).toBe(0)
  })

  // Both sides leaning at once would put both balloons toward the middle on the same
  // rows; in opposite phase the thread snakes.
  it('puts the two sides in opposite phase', () => {
    expect(zigzagShift(0, true, 20)).toBeCloseTo(20 * CHAIN_ZIGZAG, 6)
    expect(zigzagShift(1, true, 20)).toBe(0)
  })

  it('leans nowhere with no slack, so a column-wide balloon fills its column', () => {
    expect(zigzagShift(1, false, 0)).toBe(0)
    expect(zigzagShift(1, false, -3)).toBe(0)
  })
})

describe('chainRowTop', () => {
  it('places an upper row wholly above the ellipse below it, plus the gap', () => {
    const below = { top: 60, width: 40 }
    const top = chainRowTop(below, 30, 1)
    const upper = rowEllipse(row(top, 5, 30), 1)
    const lower = rowEllipse(row(60, 5, 40), 1)
    expect(lower.y1 - upper.y2).toBeCloseTo(CHAIN_ROW_GAP, 6)
  })
})

describe('stackedTop', () => {
  // Same column: the two ellipses share their horizontal span, so the upper row sits
  // clear of the lower one — exactly where the ruled table put it.
  it('stacks a row directly over the one below it, as chainRowTop does', () => {
    const below = row(60, 5, 40)
    const top = stackedTop([below], { right: 5, width: 30, stretch: 1 }, 1)
    expect(top).toBeCloseTo(chainRowTop(below.bubble, 30, 1), 6)
  })

  // Other column, no shared span: the row sinks alongside the one below it, to the
  // interleave share of that ellipse.
  it('tucks a row in beside one it does not overlap', () => {
    const below = row(60, 5, 30) // x 65..95
    const top = stackedTop([below], { right: 70, width: 25, stretch: 1 }, 1) // x 5..30
    const upper = rowEllipse(row(top, 70, 25), 1)
    const lower = rowEllipse(below, 1)
    expect(upper.y2).toBeCloseTo(lower.y1 + (lower.y2 - lower.y1) * CHAIN_INTERLEAVE, 6)
  })

  it('treats rows nearer than the column gap as overlapping', () => {
    const below = row(60, 5, 40) // ellipse x from 55 + 40 * 0.08 = 58.2
    // A row whose ellipse ends just short of that, within CHAIN_COL_GAP.
    const width = 30
    const right = 100 - width - (58.2 - CHAIN_COL_GAP / 2 - width * (BUBBLE_ELLIPSE_N.cx + BUBBLE_ELLIPSE_N.rx))
    const top = stackedTop([below], { right, width, stretch: 1 }, 1)
    const upper = rowEllipse(row(top, right, width), 1)
    expect(rowEllipse(below, 1).y1 - upper.y2).toBeCloseTo(CHAIN_ROW_GAP, 6)
  })

  // A row must clear *every* balloon it overlaps, not only the last one placed: the
  // one two rows down may still be under it once the row between tucked in beside it.
  it('clears every placed row it overlaps, not just the last', () => {
    const first = row(60, 5, 40) // right column, x 55..95
    const secondTop = stackedTop([first], { right: 70, width: 25, stretch: 1 }, 1) // left, tucks in
    const second = row(secondTop, 70, 25)
    const thirdTop = stackedTop([first, second], { right: 5, width: 40, stretch: 1 }, 1)
    const third = rowEllipse(row(thirdTop, 5, 40), 1)
    expect(rowEllipse(first, 1).y1 - third.y2).toBeGreaterThanOrEqual(CHAIN_ROW_GAP - 1e-9)
  })

  it('places a stretched row by its own taller ellipse', () => {
    const below = row(60, 5, 40)
    const plain = stackedTop([below], { right: 5, width: 30, stretch: 1 }, 1)
    const tall = stackedTop([below], { right: 5, width: 30, stretch: 2 }, 1)
    expect(tall).toBeLessThan(plain)
    const upper = rowEllipse(row(tall, 5, 30, 2), 1)
    expect(rowEllipse(below, 1).y1 - upper.y2).toBeCloseTo(CHAIN_ROW_GAP, 6)
  })

  it('reads the panel’s aspect for every height', () => {
    const below = row(60, 5, 40)
    const square = stackedTop([below], { right: 5, width: 30, stretch: 1 }, 1)
    const wide = stackedTop([below], { right: 5, width: 30, stretch: 1 }, 2)
    expect(wide).toBeLessThan(square)
  })

  it('refuses to stack on nothing', () => {
    expect(() => stackedTop([], { right: 5, width: 30, stretch: 1 }, 1)).toThrow()
  })
})

describe('segmentCrossesBox', () => {
  const box = { x1: 10, y1: 10, x2: 20, y2: 20 }

  it('is true for a segment through the box', () => {
    expect(segmentCrossesBox([0, 15], [30, 15], box)).toBe(true)
    expect(segmentCrossesBox([0, 0], [30, 30], box)).toBe(true)
  })

  it('is true for a segment ending inside the box', () => {
    expect(segmentCrossesBox([0, 0], [15, 15], box)).toBe(true)
  })

  it('is false for a segment that misses it', () => {
    expect(segmentCrossesBox([0, 25], [30, 25], box)).toBe(false)
    expect(segmentCrossesBox([0, 0], [5, 30], box)).toBe(false)
  })

  it('is false for a segment that stops short of it', () => {
    expect(segmentCrossesBox([0, 15], [5, 15], box)).toBe(false)
  })

  it('handles a segment parallel to an edge', () => {
    expect(segmentCrossesBox([15, 0], [15, 30], box)).toBe(true)
    expect(segmentCrossesBox([25, 0], [25, 30], box)).toBe(false)
  })
})

describe('tubeBlocked', () => {
  const lower = row(60, 5, 30) // right column
  const upper = row(20, 5, 30) // the same column, well above

  it('is false with nothing between two rows of a column', () => {
    expect(tubeBlocked(lower, upper, [lower, upper], 1)).toBe(false)
  })

  it('is false for a row beside the run, in the other column', () => {
    const beside = row(40, 60, 30)
    expect(tubeBlocked(lower, upper, [lower, beside, upper], 1)).toBe(false)
  })

  it('is true for a row the tube would run straight through', () => {
    const between = row(40, 5, 30)
    expect(tubeBlocked(lower, upper, [lower, between, upper], 1)).toBe(true)
  })

  it('ignores the two ends themselves', () => {
    expect(tubeBlocked(lower, upper, [upper, lower], 1)).toBe(false)
  })
})
