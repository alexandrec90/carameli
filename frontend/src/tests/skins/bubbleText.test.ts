import { describe, expect, it } from 'vitest'

import { BUBBLE_VIEW, ELLIPSE, RING_POINTS } from '../../skins/comic-book/bubbleBox'
import { ringPoints } from '../../skins/comic-book/bubbleShape'
import {
  inscribedInset, textInset, textInsetStyle, textScale,
} from '../../skins/comic-book/bubbleText'
import { BUBBLE_TYPE_KEYS } from '../../skins/comic-book/editor/bubbleTypes'
import type { BubbleType } from '../../skins/comic-book/editor/bubbleTypes'
import { cssRules, SKIN_CSS } from './skinCss'

// The lettering block has to sit inside the ink, whatever the outline is. The complaint
// this answers: a transcript filling its column ran its last lines out through the
// ellipse's shoulders, because the block was a rectangle chosen by eye and the balloon
// is not a rectangle.

/** Ray-casting point-in-polygon over a flat `[x0, y0, x1, y1, …]` ring. */
function inside(ring: number[], x: number, y: number): boolean {
  let hit = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]
    const yi = ring[i * 2 + 1]
    const xj = ring[j * 2]
    const yj = ring[j * 2 + 1]
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (crosses) hit = !hit
  }
  return hit
}

/** The four corners of `type`'s block, in view units. */
function corners(type: BubbleType): [number, number][] {
  const { top, side, bottom } = textInset(type)
  const x0 = side * BUBBLE_VIEW.w
  const x1 = (1 - side) * BUBBLE_VIEW.w
  const y0 = top * BUBBLE_VIEW.h
  const y1 = (1 - bottom) * BUBBLE_VIEW.h
  return [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]
}

describe('textInset', () => {
  it('keeps every corner of the block inside every type’s outline', () => {
    for (const type of BUBBLE_TYPE_KEYS) {
      const ring = ringPoints(type, 'none')
      for (const [x, y] of corners(type)) expect(inside(ring, x, y), `${type} (${x}, ${y})`).toBe(true)
    }
  })

  // The corners are the block's furthest points, but an edge can still cross a concave
  // outline between them — so every point along every edge is checked too.
  it('keeps the whole edge of the block inside, not only its corners', () => {
    for (const type of BUBBLE_TYPE_KEYS) {
      const ring = ringPoints(type, 'none')
      const [[x0, y0], , , [x1, y1]] = corners(type)
      for (let k = 0; k <= RING_POINTS; k++) {
        const t = k / RING_POINTS
        const x = x0 + (x1 - x0) * t
        const y = y0 + (y1 - y0) * t
        expect(inside(ring, x, y0), `${type} top edge`).toBe(true)
        expect(inside(ring, x, y1), `${type} bottom edge`).toBe(true)
        expect(inside(ring, x0, y), `${type} left edge`).toBe(true)
        expect(inside(ring, x1, y), `${type} right edge`).toBe(true)
      }
    }
  })

  it('is centred on the ellipse, so left and right insets are one number', () => {
    for (const type of BUBBLE_TYPE_KEYS) {
      const { top, side, bottom } = textInset(type)
      const centreX = (side + (1 - side)) / 2
      const centreY = (top + (1 - bottom)) / 2
      expect(centreX).toBeCloseTo(ELLIPSE.cx / BUBBLE_VIEW.w, 9)
      expect(centreY).toBeCloseTo(ELLIPSE.cy / BUBBLE_VIEW.h, 9)
    }
  })

  // A plain ellipse is the ring itself, so its block is the largest the ellipse holds. A
  // shape that cuts inside the ellipse *where the block reaches* gets less: the burst's
  // valleys do. The cloud's cusps cut in too, but between the diagonals — its eight
  // crowns sit exactly on them — so its block is the whole ellipse's as well.
  it('gives the plain ellipse the whole ellipse and a cut-in shape less', () => {
    expect(textScale('soft')).toBeCloseTo(1, 6)
    expect(textScale('cloud')).toBeCloseTo(1, 6)
    expect(textScale('lightning')).toBeLessThan(1)
    for (const type of BUBBLE_TYPE_KEYS) expect(textInset(type).side).toBeGreaterThanOrEqual(textInset('soft').side)
  })

  it('inscribes at the diagonals: a block of scale 1 has its corners on the ellipse', () => {
    const { top, side, bottom } = inscribedInset(1)
    const x = (side - ELLIPSE.cx / BUBBLE_VIEW.w) * BUBBLE_VIEW.w
    const yTop = (top - ELLIPSE.cy / BUBBLE_VIEW.h) * BUBBLE_VIEW.h
    const yBottom = (1 - bottom - ELLIPSE.cy / BUBBLE_VIEW.h) * BUBBLE_VIEW.h
    expect((x / ELLIPSE.rx) ** 2 + (yTop / ELLIPSE.ry) ** 2).toBeCloseTo(1, 9)
    expect((x / ELLIPSE.rx) ** 2 + (yBottom / ELLIPSE.ry) ** 2).toBeCloseTo(1, 9)
  })
})

describe('textInsetStyle', () => {
  it('writes the block as one inset, in percent of the box', () => {
    const { top, side, bottom } = textInset('soft')
    expect(textInsetStyle('soft')).toEqual({
      inset: `${Math.round(top * 10000) / 100}% ${Math.round(side * 10000) / 100}% ${Math.round(bottom * 10000) / 100}%`,
    })
  })

  // A control that sets no inset of its own — a field, the telephone's keys — takes the
  // stylesheet's, which is written by hand and so has to be held to the plain ellipse's.
  it('is what the stylesheet falls back to for the plain ellipse', () => {
    const css = SKIN_CSS['src/skins/comic-book/bubbles.css']
    const rule = cssRules(css).find(r => r.selector === '.cb-panel-bubble-text')
    const inset = rule?.body.match(/inset\s*:\s*([^;]+);/)
    expect(inset?.[1].trim()).toBe(textInsetStyle('soft').inset)
  })
})
