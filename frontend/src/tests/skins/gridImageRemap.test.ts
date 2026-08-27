import { describe, expect, it } from 'vitest'

import { NEW_IMAGE, seedConfig } from '../../skins/comic-book/editor/configOps'
import {
  remapImagesToGrid,
  remapImgFrame,
  resetGridKeepingImages,
  setGridKeepingImages,
} from '../../skins/comic-book/editor/gridImageRemap'
import { PANEL_GRIDS } from '../../skins/comic-book/editor/layoutConfig'
import { moveVertex } from '../../skins/comic-book/editor/panelGridOps'
import { imgRect } from '../../skins/comic-book/editor/transforms'
import type { ImgTransform, PanelGrid } from '../../skins/comic-book/editor/types'
import { constraintOf, gridPolys } from '../../skins/comic-book/panelGeometry'

// A shapes-mode edit replaces a panel grid; these ops hold every picture still while it
// does. A picture's frame is % of its panel's bounding box, so without the remap a seam
// drag would move and rescale the pictures along with the boxes.

const W = 1008
const H = 708

/** Two panels split by a vertical seam at x = 0.5. */
const SPLIT: PanelGrid = {
  vertices: [[0, 0], [0.5, 0], [1, 0], [0, 1], [0.5, 1], [1, 1]],
  panels: [[0, 1, 4, 3], [1, 2, 5, 4]],
}

/** The same subdivision with the seam dragged to x = 0.6 — both panels' boxes change. */
const SPLIT_MOVED: PanelGrid = {
  vertices: [[0, 0], [0.6, 0], [1, 0], [0, 1], [0.6, 1], [1, 1]],
  panels: [[0, 1, 4, 3], [1, 2, 5, 4]],
}

const cloneGrid = (g: PanelGrid): PanelGrid => ({
  vertices: g.vertices.map(([x, y]) => [x, y] as [number, number]),
  panels: g.panels.map(r => [...r]),
})

const img = (panel: number): ImgTransform => ({ ...NEW_IMAGE, panel })

const expectRectClose = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => {
  expect(a.x).toBeCloseTo(b.x, 8)
  expect(a.y).toBeCloseTo(b.y, 8)
  expect(a.w).toBeCloseTo(b.w, 8)
  expect(a.h).toBeCloseTo(b.h, 8)
}

describe('remapImgFrame', () => {
  it('preserves the frame in px while re-expressing it in % of the new box', () => {
    const from = { x: 100, y: 50, w: 400, h: 300 }
    const to = { x: 150, y: 50, w: 350, h: 300 }
    const out = remapImgFrame(img(0), from, to)
    expectRectClose(imgRect(to, out), imgRect(from, img(0)))
  })

  it('does not clamp: a shrunken panel may leave the frame past the usual ranges', () => {
    const out = remapImgFrame(img(0), { x: 0, y: 0, w: 1000, h: 1000 }, { x: 0, y: 0, w: 100, h: 100 })
    // 55% of 1000px is 550px, which is 550% of the 100px box — clamping would move it.
    expect(out.width).toBeCloseTo(550, 8)
    expect(out.left).toBeCloseTo(200, 8)
  })

  it('touches only the frame fields — pan, zoom and anchor render against the same px', () => {
    const t: ImgTransform = { ...img(0), scale: 1.4, offsetX: 12, offsetY: -3 }
    const out = remapImgFrame(t, { x: 0, y: 0, w: 400, h: 300 }, { x: 40, y: 0, w: 360, h: 300 })
    expect(out.scale).toBe(1.4)
    expect(out.offsetX).toBe(12)
    expect(out.offsetY).toBe(-3)
    expect(out.anchor).toBe(t.anchor)
  })
})

describe('remapImagesToGrid', () => {
  it('holds every picture still on screen when the seam between its panels moves', () => {
    const images = [img(0), img(1)]
    const before = gridPolys(SPLIT, W, H)
    const after = gridPolys(SPLIT_MOVED, W, H)
    const out = remapImagesToGrid(images, SPLIT, SPLIT_MOVED, W, H)
    for (const i of [0, 1]) {
      expectRectClose(imgRect(after[i].bounds, out[i]), imgRect(before[i].bounds, images[i]))
    }
    // The stored percentages really were rewritten — the invariant is not vacuous.
    expect(out[0].width).not.toBeCloseTo(images[0].width, 4)
    expect(out[1].left).not.toBeCloseTo(images[1].left, 4)
  })

  it('returns the same entry when the panel box did not change', () => {
    const a = img(0)
    const out = remapImagesToGrid([a], SPLIT, cloneGrid(SPLIT), W, H)
    expect(out[0]).toBe(a)
  })

  it('leaves alone a picture on an empty ring (a panel on the other page)', () => {
    const withEmpty: PanelGrid = { ...cloneGrid(SPLIT), panels: [...SPLIT.panels.map(r => [...r]), []] }
    const movedWithEmpty: PanelGrid = {
      ...cloneGrid(SPLIT_MOVED),
      panels: [...SPLIT_MOVED.panels.map(r => [...r]), []],
    }
    const a = img(2)
    expect(remapImagesToGrid([a], withEmpty, movedWithEmpty, W, H)[0]).toBe(a)
  })

  it('leaves alone a picture whose panel outruns the grid', () => {
    const a = img(99)
    expect(remapImagesToGrid([a], SPLIT, SPLIT_MOVED, W, H)[0]).toBe(a)
  })

  it('is a no-op with no viewport to measure in', () => {
    const images = [img(0)]
    expect(remapImagesToGrid(images, SPLIT, SPLIT_MOVED, 0, 0)).toBe(images)
  })
})

/** A shipped grid with one free vertex nudged — the shape edit the seam drag makes. */
function nudgedShippedGrid(page: 'classic' | 'home', kind: 'landscape') {
  const grid = PANEL_GRIDS[page][kind]
  const free = grid.vertices.findIndex(v => constraintOf(v) === 'free')
  expect(free).toBeGreaterThanOrEqual(0)
  const [x, y] = grid.vertices[free]
  return moveVertex(grid, free, [x + 0.05, y + 0.03])
}

describe('setGridKeepingImages', () => {
  it('replaces the grid and re-expresses each affected picture against its new box', () => {
    const moved = nudgedShippedGrid('classic', 'landscape')
    const before = gridPolys(PANEL_GRIDS.classic.landscape, W, H)
    const after = gridPolys(moved, W, H)
    const changed = before.findIndex(
      (p, i) => p.bounds.w > 0 && JSON.stringify(p.bounds) !== JSON.stringify(after[i].bounds),
    )
    expect(changed).toBeGreaterThanOrEqual(0)

    const cfg = { ...seedConfig(), images: [img(changed)] }
    const next = setGridKeepingImages(cfg, 'classic', 'landscape', moved, { w: W, h: H })

    expect(next.grids.classic.landscape).toEqual(moved)
    expectRectClose(
      imgRect(after[changed].bounds, next.images[0]),
      imgRect(before[changed].bounds, cfg.images[0]),
    )
    // Everything that is not a picture or the addressed grid rides along untouched.
    expect(next.bubbles).toEqual(cfg.bubbles)
    expect(next.patterns).toEqual(cfg.patterns)
    expect(next.chains).toEqual(cfg.chains)
    expect(next.grids.home).toEqual(cfg.grids.home)
  })
})

describe('resetGridKeepingImages', () => {
  it('undoes a drag exactly: reset right after an edit hands back the original framing', () => {
    const moved = nudgedShippedGrid('classic', 'landscape')
    const before = gridPolys(PANEL_GRIDS.classic.landscape, W, H)
    const changed = gridPolys(moved, W, H).findIndex(
      (p, i) => before[i].bounds.w > 0 && JSON.stringify(p.bounds) !== JSON.stringify(before[i].bounds),
    )
    const cfg = { ...seedConfig(), images: [img(changed)] }

    const dragged = setGridKeepingImages(cfg, 'classic', 'landscape', moved, { w: W, h: H })
    const back = resetGridKeepingImages(dragged, 'classic', 'landscape', { w: W, h: H })

    expect(back.grids.classic.landscape).toEqual(PANEL_GRIDS.classic.landscape)
    expect(back.images[0].left).toBeCloseTo(cfg.images[0].left, 8)
    expect(back.images[0].top).toBeCloseTo(cfg.images[0].top, 8)
    expect(back.images[0].width).toBeCloseTo(cfg.images[0].width, 8)
    expect(back.images[0].height).toBeCloseTo(cfg.images[0].height, 8)
  })
})
