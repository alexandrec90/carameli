import { describe, expect, it } from 'vitest'

import {
  BUBBLE_W,
  IMG_FRAME,
  ROTATE,
  clamp,
  dragBubble,
  dragImgFrame,
  resizeBubble,
  resizeImgFrame,
  rotateBubble,
  scaleBubble,
  sizeImgFrame,
} from '../../skins/comic-book/editor/transforms'
import type { BubbleTransform, ImgTransform } from '../../skins/comic-book/editor/types'

/**
 * A picture whose frame spans the full width of its panel box. There is no height and
 * no framing-inside-the-frame: those fields are gone, and the image half of this file
 * is about what that leaves — a box you move and a width you size.
 */
const img = (over: Partial<ImgTransform> = {}): ImgTransform => ({
  panel: 0,
  src: '/comic-book/logo.webp',
  alt: 'Carameli',
  left: 0,
  top: 0,
  width: 100,
  spill: false,
  ...over,
})

const bubble = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  panel: 0,
  top: -35,
  right: -12,
  width: 55,
  rotate: -5,
  spill: true,
  type: 'soft',
  tail: 'down-left',
  text: 'hi',
  linkTo: null,
  hoverType: null,
  clickType: null,
  ...over,
})

describe('clamp', () => {
  it('passes values inside the range through unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps to the boundaries', () => {
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })
})

// A picture briefly had two framings — a frame you moved and a picture you slid behind
// it — and `dragImg`/`scaleImg` were the second one. Both are gone. A frame built to
// the source's own ratio has no inside for anything to slide in: the picture fills it
// exactly, so moving the frame moves the picture and sizing the frame sizes it. One
// gesture each, which is what a bubble has always had.

describe('dragImgFrame', () => {
  it('converts a px drag to % of the panel box on each axis', () => {
    const next = dragImgFrame(img({ left: 10, top: 10 }), 40, -15, 200, 100)
    expect(next.left).toBe(30) // 10 + 40/200*100
    expect(next.top).toBe(-5) // 10 + -15/100*100
  })

  // The picture *is* the frame, so a move must not resize it — a drag that changed the
  // width would make a picture grow as you carried it across the panel.
  it('changes nothing but the position', () => {
    const base = img({ left: 10, top: 10, width: 55, spill: true })
    expect(dragImgFrame(base, 20, 20, 200, 100)).toEqual({ ...base, left: 20, top: 30 })
  })

  // Deliberately unclamped: hanging a frame off an edge is how a picture bleeds into
  // the gutter, and clamping to the panel would make that placement unreachable.
  it('lets the frame travel off the panel in both directions', () => {
    expect(dragImgFrame(img(), -300, -300, 200, 200).left).toBe(-150)
    expect(dragImgFrame(img(), 600, 600, 200, 200).top).toBe(300)
  })

  it('is a no-op against a zero-size panel box rather than dividing by zero', () => {
    const base = img({ left: 10, top: 10 })
    expect(dragImgFrame(base, 40, 40, 0, 100)).toBe(base)
    expect(dragImgFrame(base, 40, 40, 100, 0)).toBe(base)
  })

  it('does not mutate the input', () => {
    const base = img({ left: 10 })
    dragImgFrame(base, 40, 40, 200, 100)
    expect(base.left).toBe(10)
  })
})

describe('resizeImgFrame', () => {
  // One axis, and only one. The corner handle used to take dx *and* dy and write a
  // width and a height, which is how a picture ended up in a box of the wrong shape
  // and was cropped to fit it. dy is not a parameter any more, so it cannot be.
  it('converts the horizontal component of a corner drag to a width %', () => {
    expect(resizeImgFrame(img({ width: 50 }), 40, 200).width).toBe(70) // 50 + 40/200*100
  })

  it('anchors the top-left, so the handle tracks the pointer', () => {
    const next = resizeImgFrame(img({ left: 20, top: 30 }), 40, 200)
    expect(next.left).toBe(20)
    expect(next.top).toBe(30)
  })

  it('clamps to IMG_FRAME', () => {
    expect(resizeImgFrame(img({ width: 50 }), 9999, 200).width).toBe(IMG_FRAME.max)
    expect(resizeImgFrame(img({ width: 50 }), -9999, 200).width).toBe(IMG_FRAME.min)
  })

  it('is a no-op against a zero-width panel box', () => {
    const base = img()
    expect(resizeImgFrame(base, 40, 0)).toBe(base)
  })
})

describe('sizeImgFrame', () => {
  it('adds the delta to the width', () => {
    expect(sizeImgFrame(img({ width: 40 }), 5).width).toBe(45)
  })

  it('shrinks on a negative delta and clamps at the floor', () => {
    expect(sizeImgFrame(img({ width: 40 }), -5).width).toBe(35)
    expect(sizeImgFrame(img({ width: 6 }), -50).width).toBe(IMG_FRAME.min)
  })

  it('clamps at the ceiling', () => {
    expect(sizeImgFrame(img({ width: 390 }), 50).width).toBe(IMG_FRAME.max)
  })

  // Width is the only number there is, and that is the guarantee rather than a
  // simplification: nothing about resizing a picture can decide which part of it you
  // see, because no field for that survives to be written.
  it('changes nothing but the width', () => {
    const base = img({ left: 12, top: -4, width: 40, spill: true })
    expect(sizeImgFrame(base, 5)).toEqual({ ...base, width: 45 })
  })

  it('accumulates repeated step deltas', () => {
    let t = img({ width: 50 })
    for (let i = 0; i < 4; i++) t = sizeImgFrame(t, IMG_FRAME.step)
    expect(t.width).toBeCloseTo(50 + IMG_FRAME.step * 4, 10)
  })
})

describe('dragBubble', () => {
  it('a +10px x-drag with panelW=200 reduces right by 5%', () => {
    expect(dragBubble(bubble({ right: 0 }), 10, 0, 200, 100).right).toBe(-5)
  })

  it('a +y-drag increases top proportionally to panelH', () => {
    expect(dragBubble(bubble({ top: 0 }), 0, 20, 200, 100).top).toBe(20)
  })

  it('combines x and y in one move', () => {
    const next = dragBubble(bubble({ right: -12, top: -35 }), -20, 10, 200, 100)
    expect(next.right).toBe(-2) // -12 - (-20/200*100) = -12 + 10
    expect(next.top).toBe(-25) // -35 + (10/100*100)
  })

  it('leaves width and rotate untouched', () => {
    const next = dragBubble(bubble({ width: 55, rotate: -5 }), 10, 10, 200, 100)
    expect(next.width).toBe(55)
    expect(next.rotate).toBe(-5)
  })
})

describe('scaleBubble', () => {
  it('adds the width % delta within range', () => {
    expect(scaleBubble(bubble({ width: 40 }), 5).width).toBe(45)
    expect(scaleBubble(bubble({ width: 40 }), -5).width).toBe(35)
  })

  it('clamps to BUBBLE_W.max and BUBBLE_W.min', () => {
    expect(scaleBubble(bubble({ width: 85 }), 50).width).toBe(BUBBLE_W.max)
    expect(scaleBubble(bubble({ width: 20 }), -50).width).toBe(BUBBLE_W.min)
  })

  it('leaves position, rotate, and text untouched', () => {
    const next = scaleBubble(bubble(), 5)
    expect(next).toEqual(bubble({ width: 60 }))
  })

  it('does not mutate the input', () => {
    const base = bubble({ width: 55 })
    scaleBubble(base, 10)
    expect(base.width).toBe(55)
  })

  it('accumulates repeated wheel-notch deltas', () => {
    let b = bubble({ width: 40 })
    for (let i = 0; i < 5; i++) b = scaleBubble(b, 2)
    expect(b.width).toBe(50)
  })
})

describe('resizeBubble', () => {
  it('converts a px delta to a width % using panelW', () => {
    expect(resizeBubble(bubble({ width: 40 }), 20, 200).width).toBe(50)
  })

  it('clamps to BUBBLE_W.max', () => {
    expect(resizeBubble(bubble({ width: 80 }), 1000, 200).width).toBe(BUBBLE_W.max)
  })

  it('clamps to BUBBLE_W.min', () => {
    expect(resizeBubble(bubble({ width: 20 }), -1000, 200).width).toBe(BUBBLE_W.min)
  })
})

describe('rotateBubble', () => {
  it('adds the degree delta within range', () => {
    expect(rotateBubble(bubble({ rotate: 0 }), 10).rotate).toBe(10)
  })

  it('clamps to ±30', () => {
    expect(rotateBubble(bubble({ rotate: 20 }), 50).rotate).toBe(ROTATE.max)
    expect(rotateBubble(bubble({ rotate: -20 }), -50).rotate).toBe(ROTATE.min)
    expect(ROTATE.max).toBe(30)
    expect(ROTATE.min).toBe(-30)
  })
})
