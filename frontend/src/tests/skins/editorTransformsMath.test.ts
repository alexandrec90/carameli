import { describe, expect, it } from 'vitest'

import {
  BUBBLE_W,
  IMG_SCALE,
  ROTATE,
  clamp,
  dragBubble,
  dragImg,
  resizeBubble,
  rotateBubble,
  scaleImg,
} from '../../skins/comic-book/editor/transforms'
import type { BubbleTransform, ImgTransform } from '../../skins/comic-book/editor/types'

const img = (over: Partial<ImgTransform> = {}): ImgTransform => ({
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  anchor: 'center bottom',
  spill: false,
  ...over,
})

const bubble = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  top: -35,
  right: -12,
  width: 55,
  rotate: -5,
  spill: true,
  type: 'soft',
  text: 'hi',
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
