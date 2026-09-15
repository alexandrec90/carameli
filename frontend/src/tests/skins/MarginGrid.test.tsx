import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import MarginGrid from '../../skins/comic-book/MarginGrid'
import { frameRect, OUTER_M } from '../../skins/comic-book/panelGeometry'
import type { LayoutKind } from '../../skins/comic-book/panelGeometry'
import { SPOT_FADE_MS } from '../../skins/comic-book/spotlight'

// The loop: when the letterbox canvas paints, when it schedules another frame, when it
// repaints and when it stays quiet. What a frame draws is marginGrid.test.ts.

const WIDE = { w: 1920, h: 800 }
const EXACT = { w: 2 * OUTER_M + 1600, h: 2 * OUTER_M + 1000 }

/** Long enough for the light to have settled wherever it was going. */
const SETTLED_MS = SPOT_FADE_MS * 20

// ── A rAF the test drives by hand, a recording context, a media query ────────

let queue = new Map<number, FrameRequestCallback>()
let nextId = 1
let paints = 0
let arcs = 0
/** The clock the test hands to frames: past the real one, so no frame is "earlier". */
let clock = 0

let realRaf: typeof globalThis.requestAnimationFrame
let realCancel: typeof globalThis.cancelAnimationFrame
let realGetContext: HTMLCanvasElement['getContext']
let realMatchMedia: typeof window.matchMedia

/** Run the queued frames `advanceMs` after the last. */
function frame(advanceMs = 16) {
  clock += advanceMs
  const due = queue
  queue = new Map()
  due.forEach(cb => cb(clock))
}

function move(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))
}

function stubContext(): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: '',
    clearRect: () => { paints += 1 },
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
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
  clock = performance.now() + 1000
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
  // A visitor who asked for reduced motion: the grid follows the pointer anyway (see below).
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf
  globalThis.cancelAnimationFrame = realCancel
  HTMLCanvasElement.prototype.getContext = realGetContext
  window.matchMedia = realMatchMedia
})

/** The letterbox as Layout mounts it: the frame the page is drawn in, and the window. */
function grid(viewport: { w: number; h: number }, active: boolean, held?: LayoutKind) {
  const frame = frameRect(viewport.w, viewport.h, held)
  return <MarginGrid viewport={viewport} frame={frame} accent="#FFE033" active={active} />
}

function mount(viewport = WIDE, active = true) {
  return render(grid(viewport, active))
}

describe('MarginGrid', () => {
  it('mounts one full-viewport canvas under the page', () => {
    const { container } = mount()
    const canvas = container.querySelector('canvas.cb-margin-canvas') as HTMLCanvasElement
    expect(canvas).not.toBeNull()
    expect(canvas.width).toBe(WIDE.w)
    expect(canvas.height).toBe(WIDE.h)
    expect(canvas.getAttribute('aria-hidden')).toBe('true')
  })

  it('paints the bands on mount and keeps a frame scheduled', () => {
    mount()
    expect(paints).toBe(1)
    expect(arcs).toBeGreaterThan(0)
    expect(queue.size).toBe(1)
    frame()
    expect(queue.size).toBe(1)
  })

  it('repaints while the light is coming up, then holds still once it has settled', () => {
    mount()
    frame()
    expect(paints).toBe(2)
    frame(SETTLED_MS)
    expect(paints).toBe(3)
    // Settled: the frame callback runs, the canvas is left alone.
    frame()
    frame()
    expect(paints).toBe(3)
    expect(queue.size).toBe(1)
  })

  it('repaints when the pointer moves, and settles again on it', () => {
    mount()
    frame(SETTLED_MS)
    const before = paints
    move(40, 400)
    frame()
    expect(paints).toBe(before + 1)
    frame(SETTLED_MS)
    frame()
    expect(paints).toBe(before + 2)
  })

  it('clears once and schedules nothing on a window of the page aspect', () => {
    mount(EXACT)
    expect(paints).toBe(1)
    expect(arcs).toBe(0)
    expect(queue.size).toBe(0)
  })

  it('letterboxes the frame it is handed, so a held shape gets its bands', () => {
    // The same window, but the editor holding portrait: the page no longer fills it,
    // and the grid runs beside the frame actually drawn rather than the window's own.
    render(grid(EXACT, true, 'portrait'))
    expect(paints).toBe(1)
    expect(arcs).toBeGreaterThan(0)
    expect(queue.size).toBe(1)
  })

  it('draws nothing while the page is not showing', () => {
    mount(WIDE, false)
    expect(paints).toBe(0)
    expect(queue.size).toBe(0)
  })

  it('takes up the loop when the page comes up, and drops it on a window the sheet fills', () => {
    const view = mount(WIDE, false)
    view.rerender(grid(WIDE, true))
    expect(paints).toBe(1)
    expect(queue.size).toBe(1)
    // Now a window the sheet fills: the loop stops on its own.
    view.rerender(grid(EXACT, true))
    expect(paints).toBe(2)
    expect(arcs).toBeGreaterThan(0)
    const before = arcs
    frame()
    expect(arcs).toBe(before)
    expect(queue.size).toBe(0)
  })

  /* The old ripple's first cut held one still frame under prefers-reduced-motion, and on
     a machine with the setting on the loading sheet ran until the page was up and then
     stopped — which read as the page freezing. The grid moves only as the pointer does,
     which is nothing to reduce, and a light that stopped following the hand would read
     the same way. matchMedia reports `reduce` in every test here, so the animating cases
     above are already this assertion; this one names it, so a gate cannot come back
     quietly. */
  it('keeps following the pointer for a visitor who asked for reduced motion', () => {
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
    mount()
    frame(SETTLED_MS)
    const before = paints
    move(40, 400)
    frame()
    expect(paints).toBe(before + 1)
    expect(queue.size).toBe(1)
  })

  it('cancels its frame on unmount', () => {
    const view = mount()
    expect(queue.size).toBe(1)
    view.unmount()
    expect(queue.size).toBe(0)
  })
})
