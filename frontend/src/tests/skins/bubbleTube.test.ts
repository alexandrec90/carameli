import { describe, expect, it } from 'vitest'

import { BUBBLE_ELLIPSE_N } from '../../skins/comic-book/bubbleBox'
import {
  isBubbleRevealed,
  linkedPairs,
  tubeBetween,
} from '../../skins/comic-book/bubbleTube'
import type { Rect } from '../../skins/comic-book/bubbleTube'

/** A bubble box of the given size at the given position. */
const box = (x: number, y: number, w = 200, h = 150): Rect => ({ x, y, w, h })

/** Centre of a box's base ellipse — where a tube aims. */
function centre(r: Rect): [number, number] {
  return [r.x + r.w * BUBBLE_ELLIPSE_N.cx, r.y + r.h * BUBBLE_ELLIPSE_N.cy]
}

/** First coordinate pair of a path string. */
function firstPoint(d: string): [number, number] {
  const m = d.match(/-?\d+(?:\.\d+)?/g)
  if (!m) throw new Error(`no coordinates in ${d}`)
  return [Number(m[0]), Number(m[1])]
}

/** A bubble as the link/reveal helpers see it: which panel it is on, and its link. */
const b = (panel: number, linkTo: number | null = null) => ({ panel, linkTo })

describe('tubeBetween', () => {
  it('returns a fill and exactly two rails for a clear span', () => {
    const tube = tubeBetween(box(0, 0), box(400, 0))
    expect(tube).not.toBeNull()
    expect(tube!.rails).toHaveLength(2)
    expect(tube!.fill.startsWith('M ')).toBe(true)
    expect(tube!.fill.endsWith('Z')).toBe(true)
  })

  it('leaves both mouths open — the rails are unclosed curves', () => {
    const { rails } = tubeBetween(box(0, 0), box(400, 0))!
    rails.forEach(d => {
      expect(d.startsWith('M ')).toBe(true)
      expect(d).toContain('Q')
      expect(d).not.toContain('Z')
    })
  })

  it('is null when the two boxes are the same box', () => {
    expect(tubeBetween(box(0, 0), box(0, 0))).toBeNull()
  })

  it('is null when the bubbles already overlap, rather than drawing a smudge', () => {
    expect(tubeBetween(box(0, 0), box(30, 0))).toBeNull()
  })

  it('is null when the bubbles merely touch', () => {
    // Centres 2 · rx apart: edges meet exactly, so there is no gap to span.
    const rx = 200 * BUBBLE_ELLIPSE_N.rx
    expect(tubeBetween(box(0, 0), box(2 * rx, 0))).toBeNull()
  })

  it('sinks each mouth inside its bubble so the fill can cover the outline', () => {
    const a = box(0, 0)
    const target = box(400, 0)
    const { rails } = tubeBetween(a, target)!
    const [ax] = centre(a)
    const edge = a.w * BUBBLE_ELLIPSE_N.rx
    // The rail starts short of A's own edge — that overlap is what welds the joint.
    expect(firstPoint(rails[0])[0]).toBeLessThan(ax + edge)
    expect(firstPoint(rails[0])[0]).toBeGreaterThan(ax)
  })

  it('offsets the two rails to opposite sides of the run', () => {
    const a = box(0, 0)
    const target = box(400, 0)
    const { rails } = tubeBetween(a, target)!
    const [, ay] = centre(a)
    const y0 = firstPoint(rails[0])[1]
    const y1 = firstPoint(rails[1])[1]
    expect(Math.sign(y0 - ay)).toBe(-Math.sign(y1 - ay))
    expect(Math.abs(y0 - ay)).toBeCloseTo(Math.abs(y1 - ay), 6)
  })

  it('scales the corridor width off the narrower bubble', () => {
    const wide = tubeBetween(box(0, 0, 200, 150), box(500, 0, 200, 150))!
    const narrow = tubeBetween(box(0, 0, 200, 150), box(500, 0, 80, 60))!
    const spread = (t: typeof wide, ref: Rect): number =>
      Math.abs(firstPoint(t.rails[0])[1] - centre(ref)[1])
    expect(spread(narrow, box(0, 0))).toBeLessThan(spread(wide, box(0, 0)))
  })

  it('spans vertically as readily as horizontally', () => {
    const tube = tubeBetween(box(0, 0), box(0, 400))
    expect(tube).not.toBeNull()
    expect(tube!.rails).toHaveLength(2)
  })

  it('emits no coordinate with more than 2 decimals', () => {
    const tube = tubeBetween(box(3, 7), box(391, 113))!
    expect(tube.fill).not.toMatch(/\d\.\d{3,}/)
    tube.rails.forEach(d => expect(d).not.toMatch(/\d\.\d{3,}/))
  })
})

describe('linkedPairs', () => {
  it('finds one pair per declared link', () => {
    expect(linkedPairs([b(0, 1), b(0), b(0)])).toEqual([[0, 1]])
  })

  it('normalises a pair to ascending order regardless of which end declared it', () => {
    expect(linkedPairs([b(0), b(0), b(0, 0)])).toEqual([[0, 2]])
  })

  // Both rails would otherwise be stroked twice, which reads as a heavier line.
  it('collapses a mutual A→B / B→A declaration into one pair', () => {
    expect(linkedPairs([b(0, 1), b(0, 0)])).toEqual([[0, 1]])
  })

  it('ignores unlinked bubbles, self-links, and out-of-range indices', () => {
    expect(linkedPairs([b(0), b(0, 1), b(0, 9), b(0, -1)])).toEqual([])
  })

  it('keeps several distinct links', () => {
    expect(linkedPairs([b(0, 1), b(0), b(1, 3), b(1)])).toEqual([
      [0, 1],
      [2, 3],
    ])
  })

  // A tube between two panels would have to cross the gutter, and both ends are only
  // ever on screen together by accident — hovering reveals one panel's bubbles.
  it('drops a link whose ends sit on different panels', () => {
    expect(linkedPairs([b(0, 1), b(1)])).toEqual([])
  })

  it('keeps the same-panel links when a cross-panel one is mixed in', () => {
    expect(linkedPairs([b(0, 1), b(0), b(2, 3), b(5)])).toEqual([[0, 1]])
  })

  it('returns nothing for an empty config', () => {
    expect(linkedPairs([])).toEqual([])
  })
})

describe('isBubbleRevealed', () => {
  // Two bubbles on panel 0, one on panel 1, one on panel 3.
  const bubbles = [b(0), b(0), b(1), b(3)]

  it('reveals nothing when no panel is hovered', () => {
    expect(isBubbleRevealed(bubbles, null, false, 0)).toBe(false)
  })

  it('reveals a bubble when its own panel is hovered', () => {
    expect(isBubbleRevealed(bubbles, 0, false, 0)).toBe(true)
  })

  it('reveals every bubble the hovered panel owns, not just the first', () => {
    expect(isBubbleRevealed(bubbles, 0, false, 1)).toBe(true)
  })

  it('leaves the other panels’ bubbles hidden', () => {
    expect(isBubbleRevealed(bubbles, 0, false, 2)).toBe(false)
    expect(isBubbleRevealed(bubbles, 1, false, 0)).toBe(false)
  })

  it('reveals nothing for a panel that owns no bubble', () => {
    expect(isBubbleRevealed(bubbles, 2, false, 0)).toBe(false)
    expect(isBubbleRevealed(bubbles, 2, false, 3)).toBe(false)
  })

  it('reveals everything in edit mode so every bubble is selectable', () => {
    expect(isBubbleRevealed(bubbles, null, true, 3)).toBe(true)
  })

  it('tolerates an index with no bubble', () => {
    expect(isBubbleRevealed(bubbles, 0, false, 9)).toBe(false)
  })
})
