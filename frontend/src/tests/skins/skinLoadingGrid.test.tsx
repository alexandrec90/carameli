import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The skin's chunk is what a loading screen is waiting for, so every loader here stays
// pending and the screen under test is up for the life of the test.
vi.mock('../../skins/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../skins/registry')>()
  const pending = () => new Promise<never>(() => { })
  return {
    ...actual,
    skinLoaders: Object.fromEntries(actual.SKIN_NAMES.map(name => [name, pending])),
  }
})

import {
  gridInk, GRID_ALPHA, GRID_PAPER, GRID_REST_R, GRID_SPACING, GRID_SPOT_R,
} from '../../skins/comic-book/benDayGrid'
import { accentForPath } from '../../skins/comic-book/pageAccent'
import { SPOT_FADE_MS, SPOT_REACH } from '../../skins/comic-book/spotlight'
import { SkinProvider } from '../../skins/context'

// The paper the comic-book chunk is loading behind: the skin's own Ben-Day grid under
// the pointer light, on one canvas that stays under the page once the chunk lands
// (comicBookPaper.test.tsx). It used to run a ripple of its own here: a sine wave
// travelling the grid on a timer, which is what the tests below would catch coming back.

interface Arc { x: number; y: number; r: number; style: string }

let queue = new Map<number, FrameRequestCallback>()
let nextId = 1
let clock = 0
let arcs: Arc[] = []
let paints = 0

let realRaf: typeof globalThis.requestAnimationFrame
let realCancel: typeof globalThis.cancelAnimationFrame
let realGetContext: HTMLCanvasElement['getContext']

/** Run the queued frames `advanceMs` after the last. */
function frame(advanceMs = 16) {
  clock += advanceMs
  const due = queue
  queue = new Map()
  due.forEach(cb => cb(clock))
}

/** Frames until the light has stopped easing, so a repaint after this one is news. */
function settle() {
  for (let i = 0; i < 60; i += 1) frame(SPOT_FADE_MS)
}

function stubContext(): CanvasRenderingContext2D {
  let fillStyle = ''
  let path: Array<Omit<Arc, 'style'>> = []
  const ctx = {
    get fillStyle() { return fillStyle },
    set fillStyle(v: string) { fillStyle = v },
    clearRect: () => {},
    // The paper goes down first, so this is the start of a frame: `arcs` then holds
    // exactly what the most recent paint put on the sheet.
    fillRect: () => { paints += 1; arcs = [] },
    beginPath: () => { path = [] },
    moveTo: () => {},
    arc: (x: number, y: number, r: number) => { path.push({ x, y, r }) },
    fill: () => {
      for (const a of path) arcs.push({ ...a, style: fillStyle })
      path = []
    },
    save: () => {},
    restore: () => {},
  }
  return ctx as unknown as CanvasRenderingContext2D
}

beforeEach(() => {
  queue = new Map()
  nextId = 1
  arcs = []
  paints = 0
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
  localStorage.setItem('skin', 'comic-book')
})

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf
  globalThis.cancelAnimationFrame = realCancel
  HTMLCanvasElement.prototype.getContext = realGetContext
  localStorage.clear()
})

function renderScreen() {
  return render(<MemoryRouter><SkinProvider><div>page</div></SkinProvider></MemoryRouter>)
}

describe('the loading screen the comic-book chunk is not there to draw', () => {
  it('prints the skin\'s own grid: one flat ink on the paper, at the grid\'s centres', () => {
    renderScreen()

    const ink = `rgba(${gridInk(accentForPath('/')).join(',')},${GRID_ALPHA})`
    expect(paints).toBe(1)
    expect(arcs.length).toBeGreaterThan(0)
    expect(new Set(arcs.map(a => a.style))).toEqual(new Set([ink]))
    for (const a of arcs) {
      expect((a.x - GRID_SPACING / 2) % GRID_SPACING).toBe(0)
      expect((a.y - GRID_SPACING / 2) % GRID_SPACING).toBe(0)
      expect(a.r).toBeGreaterThanOrEqual(GRID_REST_R)
      expect(a.r).toBeLessThanOrEqual(GRID_SPOT_R)
    }
  })

  /* The ripple's tell: it redrew the whole field every frame off `performance.now()`, so
     a screen nobody was touching was in constant motion — and then handed over to a grid
     that only moves with the pointer. */
  it('holds still once the light has settled, however many frames pass', () => {
    renderScreen()
    settle()
    const painted = paints
    for (let i = 0; i < 5; i += 1) frame()

    expect(painted).toBeGreaterThan(0)
    expect(paints).toBe(painted)
  })

  it('repaints when the pointer moves, which is the only thing that moves it', () => {
    renderScreen()
    settle()
    const painted = paints

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, clientY: 90 }))
    frame()
    expect(paints).toBe(painted + 1)

    // And the light chases it there: once it has arrived, the dots under the pointer
    // are the fullest on the sheet and the far corner is back at its resting size.
    settle()
    const nearest = arcs.filter(a => Math.hypot(a.x - 120, a.y - 90) < GRID_SPACING)
    expect(nearest.length).toBeGreaterThan(0)
    expect(Math.max(...nearest.map(a => a.r))).toBeGreaterThan(GRID_REST_R)
    const far = arcs.filter(a => Math.hypot(a.x - 120, a.y - 90) > SPOT_REACH)
    expect(far.length).toBeGreaterThan(0)
    for (const a of far) expect(a.r).toBe(GRID_REST_R)
  })

  /* Painted from the effect that sizes the canvas, not from the frame after it: the
     canvas is re-inked on every route change, and a paint left to the next frame is a
     frame of bare paper in the letterbox at each one. */
  it('is painted as soon as it is mounted, before any frame has run', () => {
    renderScreen()
    expect(paints).toBe(1)
    expect(queue.size).toBe(1)
  })

  it('papers the screen behind the grid, so nothing shows through before the first frame', () => {
    const { container } = renderScreen()
    const wrapper = container.firstElementChild as HTMLElement

    expect(wrapper.style.background.toLowerCase()).toBe(GRID_PAPER.toLowerCase())
  })
})
