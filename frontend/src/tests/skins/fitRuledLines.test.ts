import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fitTableToPicture, pixelsOf } from '../../skins/comic-book/editor/fitRuledLines'
import type { PixelGrid } from '../../skins/comic-book/editor/ruledLines'
import { ruledPage } from './ruledPage'

// The browser edge of the fit: an `<img>` decoded onto a canvas and read back as pixels.
// happy-dom neither fetches images nor paints a canvas, so both are stubbed here, and
// what is under test is the plumbing — natural size in, pixels out, and every failure
// turned into a reason rather than a throw.

const PAGE = ruledPage({
  width: 300,
  height: 400,
  lineYs: [80, 120, 160, 200, 240, 280],
  margin: 40,
  lineLeft: 20,
  lineRight: 280,
})

/** A picture that "loads" at the page's size, or fails, according to its URL. */
class FakeImage {
  naturalWidth = 0
  naturalHeight = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(value: string) {
    queueMicrotask(() => {
      if (value.includes('missing')) {
        this.onerror?.()
        return
      }
      this.naturalWidth = PAGE.width
      this.naturalHeight = PAGE.height
      this.onload?.()
    })
  }
}

let realGetContext: HTMLCanvasElement['getContext']
let drawn: { w: number; h: number } | null
let contextAvailable: boolean

beforeEach(() => {
  drawn = null
  contextAvailable = true
  vi.stubGlobal('Image', FakeImage)
  realGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
    if (!contextAvailable) return null
    // Read at context time: the loader sizes the canvas before asking for its context.
    const size = { w: this.width, h: this.height }
    const ctx = {
      drawImage: () => {
        drawn = size
      },
      getImageData: (_x: number, _y: number, w: number, h: number): PixelGrid => ({
        width: w,
        height: h,
        data: PAGE.data,
      }),
    }
    return ctx as unknown as CanvasRenderingContext2D
  } as unknown as HTMLCanvasElement['getContext']
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext
  vi.unstubAllGlobals()
})

describe('pixelsOf', () => {
  it('reads the picture at its natural size, the space the quad is measured in', () => {
    const img = { naturalWidth: 300, naturalHeight: 400 } as HTMLImageElement
    const px = pixelsOf(img)
    expect(drawn).toEqual({ w: 300, h: 400 })
    expect(px.width).toBe(300)
    expect(px.height).toBe(400)
  })

  it('throws when the canvas has no 2d context to draw into', () => {
    contextAvailable = false
    const img = { naturalWidth: 300, naturalHeight: 400 } as HTMLImageElement
    expect(() => pixelsOf(img)).toThrow(/2d/)
  })
})

// Not paths under public/: nothing here is fetched, and `assetPolicy.test.ts` reads every
// served-looking path in the tree as a promise that the file exists.
const NOTEPAD = 'test://notepad'
const MISSING = 'test://missing'

describe('fitTableToPicture', () => {
  it('fits the surface to the ruling in the picture at the URL', async () => {
    const result = await fitTableToPicture(NOTEPAD)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.fit.rows).toBe(6)
  })

  it('answers with a reason, not a throw, when the picture cannot be loaded', async () => {
    const result = await fitTableToPicture(MISSING)
    expect(result).toEqual({ ok: false, reason: 'The picture could not be read.' })
  })

  it('answers with a reason when the canvas cannot be read', async () => {
    contextAvailable = false
    const result = await fitTableToPicture(NOTEPAD)
    expect(result.ok).toBe(false)
  })
})
