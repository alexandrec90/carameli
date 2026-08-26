import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PANEL_PATTERNS } from '../../skins/comic-book/editor/layoutConfig'
import { usePanelDots } from '../../skins/comic-book/usePanelDots'

// The loop itself: which panels it repaints on a frame. The clock arithmetic it
// obeys is panelDotAnim.test.ts; what a repaint draws is panelPatternMotion.test.ts.

// ── A rAF the test drives by hand, and a canvas that reports a real size ──────

let queue = new Map<number, FrameRequestCallback>()
let nextId = 1
let nowMs = 0

let realRaf: typeof globalThis.requestAnimationFrame
let realCancel: typeof globalThis.cancelAnimationFrame
let realGetContext: HTMLCanvasElement['getContext']

/** Run one animation frame `ms` after the last. */
function frame(ms = 16) {
  nowMs += ms
  const due = queue
  queue = new Map()
  due.forEach(cb => cb(nowMs))
}

/** Painted-frame counters, one per canvas — drawPanelBackground clears first. */
const paints = new WeakMap<object, { n: number }>()

function stubContext(canvas: HTMLCanvasElement) {
  const tally = { n: 0 }
  paints.set(canvas, tally)
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    clearRect: () => { tally.n += 1 },
    fillRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    fill: () => {},
  }
  return ctx as unknown as CanvasRenderingContext2D
}

/** A detached canvas that measures 120×90, which happy-dom does not lay out. */
function sizedCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'offsetWidth', { value: 120, configurable: true })
  Object.defineProperty(canvas, 'offsetHeight', { value: 90, configurable: true })
  return canvas
}

function paintCount(canvas: HTMLCanvasElement): number {
  return paints.get(canvas)?.n ?? 0
}

beforeEach(() => {
  queue = new Map()
  nextId = 1
  nowMs = 0
  realRaf = globalThis.requestAnimationFrame
  realCancel = globalThis.cancelAnimationFrame
  realGetContext = HTMLCanvasElement.prototype.getContext
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++
    queue.set(id, cb)
    return id
  }
  globalThis.cancelAnimationFrame = (id: number) => { queue.delete(id) }
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>()
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
    let ctx = contexts.get(this)
    if (!ctx) {
      ctx = stubContext(this)
      contexts.set(this, ctx)
    }
    return ctx
  } as unknown as HTMLCanvasElement['getContext']
})

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf
  globalThis.cancelAnimationFrame = realCancel
  HTMLCanvasElement.prototype.getContext = realGetContext
})

function mount(hovered: number | null = null) {
  const view = renderHook(
    ({ over }: { over: number | null }) => usePanelDots(PANEL_PATTERNS, over),
    { initialProps: { over: hovered } },
  )
  const a = sizedCanvas()
  const b = sizedCanvas()
  view.result.current[0](a)
  view.result.current[1](b)
  return { view, a, b }
}

describe('usePanelDots', () => {
  it('paints every panel once on the first frame, hovered or not', () => {
    const { a, b } = mount()
    frame()
    expect(paintCount(a)).toBe(1)
    expect(paintCount(b)).toBe(1)
  })

  // The reversion check for "not animated when it is not active": drop the gate
  // and a resting panel repaints on every frame here.
  it('leaves resting panels alone once they have their still frame', () => {
    const { a, b } = mount()
    frame()
    frame()
    frame()
    expect(paintCount(a)).toBe(1)
    expect(paintCount(b)).toBe(1)
  })

  it('animates only the hovered panel', () => {
    const { view, a, b } = mount()
    frame()
    view.rerender({ over: 0 })
    frame()
    frame()
    expect(paintCount(a)).toBe(3)
    expect(paintCount(b)).toBe(1)
  })

  it('stops the panel again when the pointer leaves it', () => {
    const { view, a } = mount()
    frame()
    view.rerender({ over: 0 })
    frame()
    const painted = paintCount(a)
    view.rerender({ over: null })
    frame()
    frame()
    expect(paintCount(a)).toBe(painted)
  })

  it('redraws a resting panel whose canvas was resized and so is blank', () => {
    const { a } = mount()
    frame()
    Object.defineProperty(a, 'offsetWidth', { value: 200, configurable: true })
    frame()
    expect(paintCount(a)).toBe(2)
    frame()
    expect(paintCount(a)).toBe(2)
  })

  it('hands out stable ref callbacks, so a re-render does not remount canvases', () => {
    const { view } = mount()
    const before = view.result.current
    view.rerender({ over: 1 })
    expect(view.result.current).toBe(before)
  })

  it('stops requesting frames once unmounted', () => {
    const { view } = mount()
    frame()
    view.unmount()
    expect(queue.size).toBe(0)
  })
})
