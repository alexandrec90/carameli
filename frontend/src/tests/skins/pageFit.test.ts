/**
 * The page-level balloon fit (pageFit.ts): a balloon follows the window's width up to a
 * page ratio and its height past it, the way a contain-fitted picture already does.
 * Stretched across two monitors a balloon used to be taller than its panel; these pin
 * the factor that stops that, and that nothing changes on the window it was drawn at.
 */

import { describe, expect, it } from 'vitest'

import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import { PAGE_FIT_ASPECT, fitBubble, fitBubbles, pageFit } from '../../skins/comic-book/pageFit'

/** The window the balloons were laid out in. */
const DESIGN = { w: 1920, h: 1017 }

describe('pageFit', () => {
  it('is 1 on the design window and on anything narrower', () => {
    expect(pageFit(DESIGN.w, DESIGN.h)).toBe(1)
    expect(pageFit(1920, 1080)).toBe(1)
    expect(pageFit(1100, 700)).toBe(1)
    expect(pageFit(600, 900)).toBe(1)
  })

  it('holds the balloon at its design-ratio size once the window is wider than that', () => {
    // Two monitors side by side: the height a 1920 window has, twice the width. The
    // balloon's rendered width is width% × fit × w, so it must come out the same.
    const w = 3840
    const h = 1000
    const rendered = (w: number, h: number) => pageFit(w, h) * w
    expect(rendered(w, h)).toBeCloseTo(PAGE_FIT_ASPECT * h, 6)
    // Twice the design width at the design ratio is exactly half.
    expect(pageFit(w, h)).toBeCloseTo(0.5, 9)
  })

  it('is continuous at the ratio', () => {
    const h = 1000
    const atRatio = PAGE_FIT_ASPECT * h
    expect(pageFit(atRatio, h)).toBeCloseTo(1, 9)
    expect(pageFit(atRatio + 1, h)).toBeLessThan(1)
  })

  it('draws the config as authored while the viewport has no size', () => {
    expect(pageFit(0, 0)).toBe(1)
    expect(pageFit(0, 500)).toBe(1)
    expect(pageFit(500, 0)).toBe(1)
  })
})

describe('fitBubble / fitBubbles', () => {
  const bubble = { ...NEW_BUBBLE, width: 40, right: 10, top: 20 }

  it('scales only the width', () => {
    const fitted = fitBubble(bubble, 0.5)
    expect(fitted.width).toBe(20)
    expect(fitted.right).toBe(10)
    expect(fitted.top).toBe(20)
  })

  it('returns the same objects at a fit of 1, so nothing keyed on identity re-lays out', () => {
    const list = [bubble, { ...bubble, width: 60 }]
    expect(fitBubble(bubble, 1)).toBe(bubble)
    expect(fitBubbles(list, 1)).toBe(list)
  })

  it('fits every balloon in a list and leaves the input alone', () => {
    const list = [bubble, { ...bubble, width: 60 }]
    const fitted = fitBubbles(list, 0.25)
    expect(fitted.map(b => b.width)).toEqual([10, 15])
    expect(list.map(b => b.width)).toEqual([40, 60])
  })
})
