/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { PANEL_IMG_TRANSFORMS } from '../../skins/comic-book/editor/layoutConfig'
import { computeLayout, PANEL_ART_SIZES } from '../../skins/comic-book/panelLayout'

/** Natural pixel size from a webp header (VP8X / VP8 / VP8L variants). */
function webpSize(file: string): { w: number; h: number } {
  const d = readFileSync(file)
  const chunkTag = d.toString('ascii', 12, 16)
  if (chunkTag === 'VP8X') {
    return {
      w: d.readUIntLE(24, 3) + 1,
      h: d.readUIntLE(27, 3) + 1,
    }
  }
  if (chunkTag === 'VP8 ') {
    return { w: d.readUInt16LE(26) & 0x3fff, h: d.readUInt16LE(28) & 0x3fff }
  }
  if (chunkTag === 'VP8L') {
    const n = d.readUInt32LE(21)
    return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 }
  }
  throw new Error(`Unrecognized webp variant in ${file}: ${chunkTag}`)
}

const PUBLIC = join(__dirname, '..', '..', '..', 'public')

describe('PANEL_ART_SIZES', () => {
  it('matches the real pixel size of every panel picture', () => {
    for (const t of PANEL_IMG_TRANSFORMS) {
      const file = join(PUBLIC, decodeURIComponent(t.src))
      expect(PANEL_ART_SIZES[t.panel], t.src).toEqual(webpSize(file))
    }
  })

  it('covers every panel exactly once', () => {
    expect(PANEL_IMG_TRANSFORMS.map(t => t.panel).sort()).toEqual(
      PANEL_ART_SIZES.map((_, i) => i),
    )
  })
})

// One viewport per layout regime, plus a wide ultrabook shape.
const VIEWPORTS: [number, number][] = [
  [1600, 900],
  [2560, 1080],
  [1000, 1000],
  [700, 1100],
]

describe('computeLayout', () => {
  it("gives every panel its artwork's exact proportions, whatever the viewport", () => {
    for (const [w, h] of VIEWPORTS) {
      for (const [i, poly] of computeLayout(w, h).entries()) {
        const art = PANEL_ART_SIZES[i]
        expect(poly.bounds.w / poly.bounds.h, `panel ${i} at ${w}x${h}`).toBeCloseTo(
          art.w / art.h,
          6,
        )
      }
    }
  })

  it('keeps every panel inside the viewport', () => {
    for (const [w, h] of VIEWPORTS) {
      for (const { bounds } of computeLayout(w, h)) {
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.y).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.w).toBeLessThanOrEqual(w)
        expect(bounds.y + bounds.h).toBeLessThanOrEqual(h)
      }
    }
  })

  it('never overlaps two panels', () => {
    for (const [w, h] of VIEWPORTS) {
      const rects = computeLayout(w, h).map(p => p.bounds)
      for (let a = 0; a < rects.length; a++) {
        for (let b = a + 1; b < rects.length; b++) {
          const overlapX =
            Math.min(rects[a].x + rects[a].w, rects[b].x + rects[b].w) -
            Math.max(rects[a].x, rects[b].x)
          const overlapY =
            Math.min(rects[a].y + rects[a].h, rects[b].y + rects[b].h) -
            Math.max(rects[a].y, rects[b].y)
          expect(
            Math.min(overlapX, overlapY),
            `panels ${a}/${b} at ${w}x${h}`,
          ).toBeLessThanOrEqual(0.001)
        }
      }
    }
  })

  it('centres the page block symmetrically', () => {
    for (const [w, h] of VIEWPORTS) {
      const rects = computeLayout(w, h).map(p => p.bounds)
      const left = Math.min(...rects.map(r => r.x))
      const right = w - Math.max(...rects.map(r => r.x + r.w))
      const top = Math.min(...rects.map(r => r.y))
      const bottom = h - Math.max(...rects.map(r => r.y + r.h))
      expect(left, `x margins at ${w}x${h}`).toBeCloseTo(right, 6)
      expect(top, `y margins at ${w}x${h}`).toBeCloseTo(bottom, 6)
    }
  })
})
