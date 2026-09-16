import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WASH_REVEAL_MS } from '../../skins/comic-book/benDayWash'
import { LoadingOverlay, useLoadingScreen } from '../../skins/comic-book/LoadingOverlay'
import { SPOT_FADE_MS } from '../../skins/comic-book/spotlight'
import { useSlowReady } from '../../hooks/useSlowLoading'

// The loading sheet's loops: the lit grid behind the legend, which repaints only on a
// frame the light moved or the window resized, and the wash that takes the sheet away
// once the page is ready. What a frame draws is marginGrid.test.ts.

const SETTLED_MS = SPOT_FADE_MS * 20

let queue = new Map<number, FrameRequestCallback>()
let nextId = 1
/** Paper fills: one per grid paint. */
let papers = 0
/** Clears: one per wash frame. */
let clears = 0
let clock = 0

let realRaf: typeof globalThis.requestAnimationFrame
let realCancel: typeof globalThis.cancelAnimationFrame
let realGetContext: HTMLCanvasElement['getContext']

function frame(advanceMs = 16) {
  clock += advanceMs
  const due = queue
  queue = new Map()
  act(() => { due.forEach(cb => cb(clock)) })
}

function move(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))
}

function stubContext(): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: '',
    clearRect: () => { clears += 1 },
    fillRect: () => { papers += 1 },
    beginPath: () => {},
    moveTo: () => {},
    arc: () => {},
    fill: () => {},
  }
  return ctx as unknown as CanvasRenderingContext2D
}

function Harness({ ready }: { ready: boolean }) {
  const screen = useLoadingScreen(ready, '#FFE033')
  return <LoadingOverlay screen={screen} />
}

/** Layout's own composition: `?slow=1`'s hold in front of the sheet's state machine. */
function BrakedHarness({ ready, ms }: { ready: boolean; ms: number }) {
  const screen = useLoadingScreen(useSlowReady(ready, ms), '#FFE033')
  return <LoadingOverlay screen={screen} />
}

/** The sheet up: first visit, so it shows on the next tick. */
function mountLoading() {
  const view = render(<Harness ready={false} />)
  act(() => { vi.advanceTimersByTime(0) })
  return view
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  localStorage.removeItem('comic-book:loaded')
  queue = new Map()
  nextId = 1
  papers = 0
  clears = 0
  clock = performance.now() + 1000
  realRaf = globalThis.requestAnimationFrame
  realCancel = globalThis.cancelAnimationFrame
  realGetContext = HTMLCanvasElement.prototype.getContext
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++
    queue.set(id, cb)
    return id
  }
  globalThis.cancelAnimationFrame = (id: number) => { queue.delete(id) }
  HTMLCanvasElement.prototype.getContext = (() =>
    stubContext()) as unknown as HTMLCanvasElement['getContext']
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.requestAnimationFrame = realRaf
  globalThis.cancelAnimationFrame = realCancel
  HTMLCanvasElement.prototype.getContext = realGetContext
})

describe('the loading sheet', () => {
  it('is up with its canvas once the delay has passed', () => {
    const { container } = mountLoading()
    expect(container.querySelector('.cb-loading-overlay')).not.toBeNull()
    expect(container.querySelector('canvas.cb-loading-canvas')).not.toBeNull()
    expect(queue.size).toBe(1)
  })

  it('paints the grid on its first frame and holds still once the light has settled', () => {
    mountLoading()
    expect(papers).toBe(0)
    frame()
    expect(papers).toBe(1)
    frame(SETTLED_MS)
    expect(papers).toBe(2)
    frame()
    frame()
    expect(papers).toBe(2)
    expect(queue.size).toBe(1)
  })

  it('repaints when the pointer moves', () => {
    mountLoading()
    frame()
    frame(SETTLED_MS)
    const before = papers
    move(120, 80)
    frame()
    expect(papers).toBe(before + 1)
  })

  it('repaints after a resize, whose blank bitmap the still light would otherwise leave', () => {
    mountLoading()
    frame()
    frame(SETTLED_MS)
    const before = papers
    act(() => { window.dispatchEvent(new Event('resize')) })
    frame()
    expect(papers).toBe(before + 1)
  })

  it('washes away once the page is ready, every frame, and then stops', () => {
    const view = mountLoading()
    frame()
    view.rerender(<Harness ready />)
    // The grid loop is gone; the leave wash is the one frame scheduled. Its timeline
    // starts from the real clock, so the frames below are measured from there.
    expect(queue.size).toBe(1)
    clock = performance.now()
    const before = clears
    frame()
    frame()
    expect(clears).toBe(before + 2)
    frame(WASH_REVEAL_MS * 2)
    expect(clears).toBe(before + 3)
    expect(queue.size).toBe(0)
    expect(view.container.querySelector('.cb-loading-overlay')).toBeNull()
  })
})

// This is the gate `?slow=1` exists for: a page of cached pictures settles inside the
// sheet's own delay, so on a warm machine the sheet never paints and its wash — the one
// transition the flag is turned on to watch — never runs at all.
describe('the loading sheet under the `?slow=1` brake', () => {
  it('paints the sheet on a load that would otherwise have shown nothing', () => {
    // Ready from the first render, the way a fully cached page is.
    const { container } = render(<BrakedHarness ready ms={1000} />)
    act(() => { vi.advanceTimersByTime(0) })

    expect(container.querySelector('.cb-loading-overlay')).not.toBeNull()
    frame()
    expect(papers).toBe(1)
  })

  it('holds the sheet up for the whole brake, then hands off to the wash', () => {
    const view = render(<BrakedHarness ready ms={1000} />)
    act(() => { vi.advanceTimersByTime(0) })
    frame()

    act(() => { vi.advanceTimersByTime(999) })
    expect(view.container.querySelector('.cb-loading-overlay')).not.toBeNull()
    expect(view.container.querySelector('.cb-loading-leaving')).toBeNull()

    act(() => { vi.advanceTimersByTime(1) })
    expect(view.container.querySelector('.cb-loading-leaving')).not.toBeNull()

    // And the wash still runs to completion and takes the sheet with it.
    clock = performance.now()
    frame()
    frame(WASH_REVEAL_MS * 2)
    expect(view.container.querySelector('.cb-loading-overlay')).toBeNull()
  })

  // The other half of the brake — dropping this sheet's own 400 ms return-visit delay to
  // zero — is `slowLoaderDelay`, covered in `tests/lib/slowLoading.test.ts`. It cannot be
  // asserted from here: `useLoadingScreen` reads the resolved flag rather than taking a
  // delay, so it is 0 in a test process with no `?slow` in its URL.
  it('changes nothing with the brake off', () => {
    const { container } = render(<BrakedHarness ready ms={0} />)
    act(() => { vi.advanceTimersByTime(0) })
    expect(container.querySelector('.cb-loading-overlay')).toBeNull()
  })
})
