import { logger } from '../../../lib/logger'
import { detectRuledLines } from './ruledLines'
import type { PixelGrid, RuledFitResult } from './ruledLines'

// The browser edge of the ruled-line fit: getting a picture's pixels out of an `<img>`
// and into `detectRuledLines`. Kept apart from the detector because this is the only part
// that needs a document, a canvas and a network — and the only part a test has to stub.

/** A picture, decoded. Rejects when the browser cannot load it. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${src}`))
    img.src = src
  })
}

/**
 * A decoded picture's pixels at its natural size — the artwork's own, which is the space
 * a surface's `quad` is measured in, so nothing here has to know how big the picture is
 * drawn on the page or how the author has zoomed it.
 */
export function pixelsOf(img: HTMLImageElement): PixelGrid {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d canvas context')
  ctx.drawImage(img, 0, 0)
  const { width, height, data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { width, height, data }
}

/**
 * Fit a surface to the ruling drawn in the picture at `src`.
 *
 * Never throws: a picture that cannot be loaded or read — the served tree is missing it,
 * or a cross-origin one taints the canvas — comes back as a `reason` the inspector shows
 * beside the button, the same way "no lines found" does. The failure is logged too,
 * because a `reason` is what the author sees and a warning is what the next debugger
 * greps for.
 */
export async function fitTableToPicture(src: string): Promise<RuledFitResult> {
  try {
    return detectRuledLines(pixelsOf(await loadImage(src)))
  } catch (err) {
    logger.warn('Could not read a picture to fit its ruled lines', { src, err: String(err) })
    return { ok: false, reason: 'The picture could not be read.' }
  }
}
