import { describe, expect, it } from 'vitest'

import { BUBBLE_ASPECT, BUBBLE_VIEW, ELLIPSE, tailTip } from '../../skins/comic-book/bubbleBox'
import { anchorOf, anchorPoint, placeOnAnchor } from '../../skins/comic-book/chainAnchor'
import type { PanelPoint } from '../../skins/comic-book/chainAnchor'

// The point a chain's newest balloons are drawn about: the tail tip the author aimed at a
// character's mouth, kept still while the balloon around it takes the size of its words.

const balloon = (over: Partial<Parameters<typeof anchorOf>[0]> = {}) => ({
  top: 60,
  right: 5,
  width: 40,
  rotate: 0,
  tail: 'down-left' as const,
  ...over,
})

const expectSamePoint = (a: PanelPoint, b: PanelPoint) => {
  expect(a[0]).toBeCloseTo(b[0], 9)
  expect(a[1]).toBeCloseTo(b[1], 9)
}

describe('anchorPoint', () => {
  it('is the tail tip of a tailed balloon', () => {
    expect(anchorPoint('down-left')).toEqual(tailTip('down-left'))
    expect(anchorPoint('up')).toEqual(tailTip('up'))
  })

  it('is the ellipse centre, not the box centre, of a tailless one', () => {
    expect(anchorPoint('none')).toEqual([ELLIPSE.cx, ELLIPSE.cy])
    expect(ELLIPSE.cy).not.toBe(BUBBLE_VIEW.h / 2)
  })
})

describe('anchorOf', () => {
  it('maps the viewBox tip through the balloon’s box, in the panel’s % units', () => {
    const b = balloon({ tail: 'down', rotate: 0 })
    const [tipX, tipY] = tailTip('down')
    const left = 100 - b.right - b.width
    const height = b.width * BUBBLE_ASPECT
    const [x, y] = anchorOf(b, 1)
    expect(x).toBeCloseTo(left + (tipX / BUBBLE_VIEW.w) * b.width, 9)
    expect(y).toBeCloseTo(b.top + (tipY / BUBBLE_VIEW.h) * height, 9)
  })

  it('converts the vertical through the panel’s aspect', () => {
    const b = balloon({ tail: 'down', rotate: 0 })
    const [tipX, tipY] = tailTip('down')
    // Twice as wide as tall: a balloon 40% of the width is 40% * aspect of the height.
    const [x, y] = anchorOf(b, 2)
    expect(x).toBeCloseTo(100 - b.right - b.width + (tipX / BUBBLE_VIEW.w) * b.width, 9)
    expect(y).toBeCloseTo(b.top + (tipY / BUBBLE_VIEW.h) * b.width * BUBBLE_ASPECT * 2, 9)
  })

  it('carries a stretched balloon’s tip further down its taller box', () => {
    const b = balloon({ tail: 'down', rotate: 0 })
    const [, plain] = anchorOf(b, 1)
    const [, tall] = anchorOf(b, 1, 2)
    expect(tall - b.top).toBeCloseTo((plain - b.top) * 2, 9)
  })

  it('turns the tip about the box centre with the balloon', () => {
    // A tail straight down, turned a quarter turn clockwise, points left of centre.
    const b = balloon({ tail: 'down', rotate: 90 })
    const centreX = 100 - b.right - b.width / 2
    const centreY = b.top + (b.width * BUBBLE_ASPECT) / 2
    const [x, y] = anchorOf(b, 1)
    expect(x).toBeLessThan(centreX)
    expect(y).toBeCloseTo(centreY, 9)
    // Turned the other way, the same distance to the right.
    const [mirrored] = anchorOf({ ...b, rotate: -90 }, 1)
    expect(mirrored - centreX).toBeCloseTo(centreX - x, 9)
  })
})

describe('placeOnAnchor', () => {
  it('inverts anchorOf, so a balloon put on its own anchor does not move', () => {
    const b = balloon({ rotate: -5 })
    expect(placeOnAnchor(anchorOf(b, 1.4), b, 1, 1.4)).toEqual({
      top: expect.closeTo(b.top, 9),
      right: expect.closeTo(b.right, 9),
    })
  })

  it('lands a narrower balloon’s tip on the same point', () => {
    const template = balloon({ rotate: -5 })
    const anchor = anchorOf(template, 1)
    const narrow = { ...template, width: 20 }
    const placed = { ...narrow, ...placeOnAnchor(anchor, narrow, 1, 1) }
    expectSamePoint(anchorOf(placed, 1), anchor)
    // And it moved to do so: the narrower balloon hangs off the tip, not the corner.
    expect(placed.top).not.toBeCloseTo(template.top, 6)
    expect(placed.right).not.toBeCloseTo(template.right, 6)
  })

  it('lands a stretched balloon’s tip on the same point, by growing away from it', () => {
    const template = balloon({ tail: 'down', rotate: 0 })
    const anchor = anchorOf(template, 1)
    const at = placeOnAnchor(anchor, template, 2, 1)
    expectSamePoint(anchorOf({ ...template, ...at }, 1, 2), anchor)
    // A tail pointing down keeps its tip and takes the extra height upward.
    expect(at.top).toBeLessThan(template.top)
    expect(at.right).toBeCloseTo(template.right, 9)
  })

  it('holds a rotated balloon’s tip through a size change, on a non-square panel', () => {
    const template = balloon({ tail: 'up-right', rotate: 17 })
    const anchor = anchorOf(template, 0.6)
    const other = { ...template, width: 31 }
    const placed = { ...other, ...placeOnAnchor(anchor, other, 1.7, 0.6) }
    expectSamePoint(anchorOf(placed, 0.6, 1.7), anchor)
  })

  it('centres a tailless balloon on its ellipse, whatever its size', () => {
    const template = balloon({ tail: 'none', rotate: 0 })
    const anchor = anchorOf(template, 1)
    const small = { ...template, width: 10 }
    const placed = { ...small, ...placeOnAnchor(anchor, small, 1, 1) }
    expectSamePoint(anchorOf(placed, 1), anchor)
    const centreX = 100 - placed.right - placed.width / 2
    expect(centreX).toBeCloseTo(100 - template.right - template.width / 2, 9)
  })
})
