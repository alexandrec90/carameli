import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import MarginRipple, { prefersReducedMotion } from '../../skins/comic-book/MarginRipple'
import { OUTER_M } from '../../skins/comic-book/panelGeometry'

// The loop: when the letterbox canvas paints, when it schedules another frame and when
// it stays quiet. What a frame draws is marginRipple.test.ts.

const WIDE = { w: 1920, h: 800 }
const EXACT = { w: 2 * OUTER_M + 1600, h: 2 * OUTER_M + 1000 }

// ── A rAF the test drives by hand, a recording context, a media query ────────

let queue = new Map<number, FrameRequestCallback>()
let nextId = 1
let paints = 0
let arcs = 0
let reduceMotion = false

let realRaf: typeof globalThis.requestAnimationFrame
let realCancel: typeof globalThis.cancelAnimationFrame
let realGetContext: HTMLCanvasElement['getContext']
let realMatchMedia: typeof window.matchMedia

function frame() {
  const due = queue
  queue = new Map()
  due.forEach(cb => cb(performance.now()))
}

function stubContext(): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: '',
    clearRect: () => { paints += 1 },
    fillRect: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    arc: () => { arcs += 1 },
    fill: () => {},
    save: () => {},
    restore: () => {},
  }
  return ctx as unknown as CanvasRenderingContext2D
}

beforeEach(() => {
  queue = new Map()
  nextId = 1
  paints = 0
  arcs = 0
  reduceMotion = false
  realRaf = globalThis.requestAnimationFrame
  realCancel = globalThis.cancelAnimationFrame
  realGetContext = HTMLCanvasElement.prototype.getContext
  realMatchMedia = window.matchMedia
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++
    queue.set(id, cb)
    return id
  }
  globalThis.cancelAnimationFrame = (id: number) => { queue.delete(id) }
  HTMLCanvasElement.prototype.getContext = (() =>
    stubContext()) as unknown as HTMLCanvasElement['getContext']
  window.matchMedia = ((query: string) => ({
    matches: reduceMotion && query.includes('prefers-reduced-motion'),
    media: query,
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf
  globalThis.cancelAnimationFrame = realCancel
  HTMLCanvasElement.prototype.getContext = realGetContext
  window.matchMedia = realMatchMedia
})

function mount(viewport = WIDE, active = true) {
  return render(<MarginRipple viewport={viewport} accent="#FFE033" active={active} />)
}

describe('MarginRipple', () => {
  it('mounts one full-viewport canvas under the page', () => {
    const { container } = mount()
    const canvas = container.querySelector('canvas.cb-margin-canvas') as HTMLCanvasElement
    expect(canvas).not.toBeNull()
    expect(canvas.width).toBe(WIDE.w)
    expect(canvas.height).toBe(WIDE.h)
    expect(canvas.getAttribute('aria-hidden')).toBe('true')
  })

  it('paints the bands on mount and keeps painting, one frame per frame', () => {
    mount()
    expect(paints).toBe(1)
    expect(arcs).toBeGreaterThan(0)
    expect(queue.size).toBe(1)
    frame()
    expect(paints).toBe(2)
    expect(queue.size).toBe(1)
  })

  it('clears once and schedules nothing on a window of the page aspect', () => {
    mount(EXACT)
    expect(paints).toBe(1)
    expect(arcs).toBe(0)
    expect(queue.size).toBe(0)
  })

  it('draws nothing while the page is not showing', () => {
    mount(WIDE, false)
    expect(paints).toBe(0)
    expect(queue.size).toBe(0)
  })

  it('takes up the loop when the page comes up, and the bands with a resize', () => {
    const view = mount(WIDE, false)
    view.rerender(<MarginRipple viewport={WIDE} accent="#FFE033" active />)
    expect(paints).toBe(1)
    expect(queue.size).toBe(1)
    // Now a window the sheet fills: the loop stops on its own.
    view.rerender(<MarginRipple viewport={EXACT} accent="#FFE033" active />)
    expect(paints).toBe(2)
    expect(arcs).toBeGreaterThan(0)
    const before = arcs
    frame()
    expect(arcs).toBe(before)
    expect(queue.size).toBe(0)
  })

  it('draws one still frame under prefers-reduced-motion', () => {
    reduceMotion = true
    expect(prefersReducedMotion()).toBe(true)
    mount()
    expect(paints).toBe(1)
    expect(arcs).toBeGreaterThan(0)
    expect(queue.size).toBe(0)
  })

  it('cancels its frame on unmount', () => {
    const view = mount()
    expect(queue.size).toBe(1)
    view.unmount()
    expect(queue.size).toBe(0)
  })
})
