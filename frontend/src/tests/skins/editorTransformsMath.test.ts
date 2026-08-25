import { describe, expect, it } from 'vitest'

import {
  BUBBLE_W,
  IMG_FRAME,
  IMG_SCALE,
  ROTATE,
  clamp,
  dragBubble,
  dragImg,
  dragImgFrame,
  resizeBubble,
  resizeImgFrame,
  rotateBubble,
  scaleBubble,
  scaleImg,
  sizeImgFrame,
} from '../../skins/comic-book/editor/transforms'
import type { BubbleTransform, ImgTransform } from '../../skins/comic-book/editor/types'

/** A picture at the shipped default: full-panel frame, identity framing inside it. */
const img = (over: Partial<ImgTransform> = {}): ImgTransform => ({
  panel: 0,
  src: '/comic-book/logo.webp',
  alt: 'Carameli',
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  anchor: 'center bottom',
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
  content: 'text',
  text: 'hi',
  linkTo: null,
  hoverType: null,
  clickType: null,
  chain: '',
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

describe('dragImg', () => {
  it('adds the px deltas to the offsets and leaves scale/anchor alone', () => {
    const next = dragImg(img({ offsetX: 4, offsetY: -2, scale: 1.5 }), 10, -20)
    expect(next).toEqual(img({ offsetX: 14, offsetY: -22, scale: 1.5 }))
  })

  it('does not mutate the input', () => {
    const base = img()
    dragImg(base, 5, 5)
    expect(base.offsetX).toBe(0)
  })

  // A picture has two independent framings now. This one slides the picture behind a
  // window that stays put; dragImgFrame moves the window. Before the frame existed
  // they were the same gesture, and that was the bug.
  it('leaves the frame exactly where it was', () => {
    const next = dragImg(img({ left: 20, top: 20, width: 55, height: 55 }), 40, 40)
    expect([next.left, next.top, next.width, next.height]).toEqual([20, 20, 55, 55])
  })
})

describe('dragImgFrame', () => {
  it('converts a px drag to % of the panel box on each axis', () => {
    const next = dragImgFrame(img({ left: 10, top: 10 }), 40, -15, 200, 100)
    expect(next.left).toBe(30) // 10 + 40/200*100
    expect(next.top).toBe(-5) // 10 + -15/100*100
  })

  it('leaves the frame size and the picture inside it alone', () => {
    const next = dragImgFrame(img({ width: 55, height: 40, offsetX: 7, scale: 2 }), 20, 20, 200, 100)
    expect(next.width).toBe(55)
    expect(next.height).toBe(40)
    expect(next.offsetX).toBe(7)
    expect(next.scale).toBe(2)
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
  it('converts a corner px drag to a width/height % on each axis separately', () => {
    const next = resizeImgFrame(img({ width: 50, height: 50 }), 40, -25, 200, 100)
    expect(next.width).toBe(70) // 50 + 40/200*100
    expect(next.height).toBe(25) // 50 + -25/100*100
  })

  it('anchors the top-left, so the handle tracks the pointer', () => {
    const next = resizeImgFrame(img({ left: 20, top: 30 }), 40, 40, 200, 200)
    expect(next.left).toBe(20)
    expect(next.top).toBe(30)
  })

  it('clamps to IMG_FRAME on both axes', () => {
    expect(resizeImgFrame(img({ width: 50 }), 9999, 0, 200, 200).width).toBe(IMG_FRAME.max)
    expect(resizeImgFrame(img({ height: 50 }), 0, -9999, 200, 200).height).toBe(IMG_FRAME.min)
  })

  it('is a no-op against a zero-size panel box', () => {
    const base = img()
    expect(resizeImgFrame(base, 40, 40, 0, 0)).toBe(base)
  })
})

describe('sizeImgFrame', () => {
  it('grows both axes by the same % — the keyboard has no drag direction', () => {
    const next = sizeImgFrame(img({ width: 40, height: 60 }), 5)
    expect(next.width).toBe(45)
    expect(next.height).toBe(65)
  })

  it('shrinks on a negative delta and clamps at the floor', () => {
    expect(sizeImgFrame(img({ width: 40, height: 40 }), -5).width).toBe(35)
    expect(sizeImgFrame(img({ width: 6, height: 6 }), -50)).toMatchObject({
      width: IMG_FRAME.min,
      height: IMG_FRAME.min,
    })
  })

  it('clamps at the ceiling', () => {
    expect(sizeImgFrame(img({ width: 390, height: 390 }), 50).width).toBe(IMG_FRAME.max)
  })

  it('leaves the frame position and the picture inside it alone', () => {
    const next = sizeImgFrame(img({ left: 12, top: -4, scale: 1.5, offsetX: 9 }), IMG_FRAME.step)
    expect(next.left).toBe(12)
    expect(next.top).toBe(-4)
    expect(next.scale).toBe(1.5)
    expect(next.offsetX).toBe(9)
  })

  it('accumulates repeated step deltas', () => {
    let t = img({ width: 50, height: 50 })
    for (let i = 0; i < 4; i++) t = sizeImgFrame(t, IMG_FRAME.step)
    expect(t.width).toBeCloseTo(50 + IMG_FRAME.step * 4, 10)
  })
})

describe('scaleImg', () => {
  it('adds the delta within range', () => {
    expect(scaleImg(img({ scale: 2 }), 0.5).scale).toBe(2.5)
  })

  it('allows zooming out below fill (scale < 1)', () => {
    expect(scaleImg(img({ scale: 1 }), -0.5).scale).toBe(0.5)
  })

  it('clamps at the min', () => {
    expect(scaleImg(img({ scale: 0.3 }), -0.5).scale).toBe(IMG_SCALE.min)
    expect(IMG_SCALE.min).toBe(0.2)
  })

  it('clamps at the max', () => {
    expect(scaleImg(img({ scale: 3.9 }), 1).scale).toBe(IMG_SCALE.max)
  })

  it('accumulates repeated step deltas', () => {
    let t = img({ scale: 1 })
    for (let i = 0; i < 4; i++) t = scaleImg(t, IMG_SCALE.step)
    expect(t.scale).toBeCloseTo(1 + IMG_SCALE.step * 4, 10)
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
