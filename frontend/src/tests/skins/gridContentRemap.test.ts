import { describe, expect, it } from 'vitest'

import { NEW_BUBBLE, NEW_IMAGE, seedConfig } from '../../skins/comic-book/editor/configOps'
import {
  remapBubbleBox,
  remapBubblesToGrid,
  remapImagesToGrid,
  remapImgFrame,
  resetGridKeepingContent,
  setGridKeepingContent,
} from '../../skins/comic-book/editor/gridContentRemap'
import { PANEL_GRIDS } from '../../skins/comic-book/editor/layoutConfig'
import { moveVertex } from '../../skins/comic-book/editor/panelGridOps'
import { bubbleRect, imgRect } from '../../skins/comic-book/editor/transforms'
import type { BubbleTransform, ImgTransform, PanelGrid } from '../../skins/comic-book/editor/types'
import { constraintOf, gridPolys } from '../../skins/comic-book/panelGeometry'

// A shapes-mode edit replaces a panel grid; these ops hold every picture and every
// balloon still while it does. Both are stored in % of their panel's bounding box, so
// without the remap a seam drag would move and rescale the content along with the boxes.

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
const bubble = (panel: number): BubbleTransform => ({ ...NEW_BUBBLE, panel })

type Box = { x: number; y: number; w: number; h: number }

const expectRectClose = (a: Box, b: Box) => {
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

describe('remapBubbleBox', () => {
  it('preserves the balloon in px — right-anchored, and its height follows its width', () => {
    const from = { x: 100, y: 50, w: 400, h: 300 }
    const to = { x: 150, y: 20, w: 350, h: 360 }
    const out = remapBubbleBox(bubble(0), from, to)
    expectRectClose(bubbleRect(to, out), bubbleRect(from, bubble(0)))
  })

  it('holds a balloon that floats outside its panel — the negative offsets stay negative', () => {
    // NEW_BUBBLE spills up and to the right of its panel; a spilling balloon is the
    // ordinary case here, not an edge one, so the remap must not fold it back inside.
    const from = { x: 0, y: 0, w: 400, h: 300 }
    const to = { x: 0, y: 0, w: 300, h: 300 }
    const out = remapBubbleBox(bubble(0), from, to)
    expect(out.top).toBeLessThan(0)
    expect(out.right).toBeLessThan(0)
    expectRectClose(bubbleRect(to, out), bubbleRect(from, bubble(0)))
  })

  it('does not clamp to the authoring width bounds', () => {
    // 55% of 1000px is 550px — 550% of the new box, far past BUBBLE_W.max (90).
    const out = remapBubbleBox(bubble(0), { x: 0, y: 0, w: 1000, h: 1000 }, { x: 0, y: 0, w: 100, h: 100 })
    expect(out.width).toBeCloseTo(550, 8)
  })

  it('leaves rotation, tail, type and content alone', () => {
    const t: BubbleTransform = { ...bubble(0), rotate: -12 }
    const out = remapBubbleBox(t, { x: 0, y: 0, w: 400, h: 300 }, { x: 40, y: 0, w: 360, h: 300 })
    expect(out.rotate).toBe(-12)
    expect(out.tail).toBe(t.tail)
    expect(out.type).toBe(t.type)
    expect(out.text).toBe(t.text)
    expect(out.chain).toBe(t.chain)
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
    expect(remapImagesToGrid([a], SPLIT, cloneGrid(SPLIT), W, H)[0]).toBe(a)
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

describe('remapBubblesToGrid', () => {
  it('holds every balloon still on screen when the seam between its panels moves', () => {
    const bubbles = [bubble(0), bubble(1)]
    const before = gridPolys(SPLIT, W, H)
    const after = gridPolys(SPLIT_MOVED, W, H)
    const out = remapBubblesToGrid(bubbles, SPLIT, SPLIT_MOVED, W, H)
    for (const i of [0, 1]) {
      expectRectClose(bubbleRect(after[i].bounds, out[i]), bubbleRect(before[i].bounds, bubbles[i]))
    }
    expect(out[0].width).not.toBeCloseTo(bubbles[0].width, 4)
    expect(out[1].right).not.toBeCloseTo(bubbles[1].right, 4)
  })

  it('keeps a chained column together: same chain id, same order, same gaps', () => {
    const column = [
      { ...bubble(0), chain: 'thread', top: 10 },
      { ...bubble(0), chain: 'thread', top: 40 },
    ]
    const before = gridPolys(SPLIT, W, H)[0].bounds
    const after = gridPolys(SPLIT_MOVED, W, H)[0].bounds
    const out = remapBubblesToGrid(column, SPLIT, SPLIT_MOVED, W, H)

    expect(out.map(b => b.chain)).toEqual(['thread', 'thread'])
    expect(out[0].top).toBeLessThan(out[1].top)
    // A chain entry carries behaviour and no geometry, so the column is only ever as
    // still as the balloons that are its slots: hold each, and the gap holds too.
    const gapBefore = bubbleRect(before, column[1]).y - bubbleRect(before, column[0]).y
    const gapAfter = bubbleRect(after, out[1]).y - bubbleRect(after, out[0]).y
    expect(gapAfter).toBeCloseTo(gapBefore, 8)
  })

  it('returns the same entry when the panel box did not change', () => {
    const a = bubble(0)
    expect(remapBubblesToGrid([a], SPLIT, cloneGrid(SPLIT), W, H)[0]).toBe(a)
  })

  it('leaves alone a balloon whose panel outruns the grid', () => {
    const a = bubble(99)
    expect(remapBubblesToGrid([a], SPLIT, SPLIT_MOVED, W, H)[0]).toBe(a)
  })

  it('is a no-op with no viewport to measure in', () => {
    const bubbles = [bubble(0)]
    expect(remapBubblesToGrid(bubbles, SPLIT, SPLIT_MOVED, 0, 0)).toBe(bubbles)
  })
})

/** A shipped grid with one free vertex nudged — the shape edit the seam drag makes. */
function nudgedShippedGrid() {
  const grid = PANEL_GRIDS.classic.landscape
  const free = grid.vertices.findIndex(v => constraintOf(v) === 'free')
  expect(free).toBeGreaterThanOrEqual(0)
  const [x, y] = grid.vertices[free]
  return moveVertex(grid, free, [x + 0.05, y + 0.03])
}

/** The first panel the nudge actually reshapes, and the two boxes it moves between. */
function reshapedPanel(moved: PanelGrid) {
  const before = gridPolys(PANEL_GRIDS.classic.landscape, W, H)
  const after = gridPolys(moved, W, H)
  const panel = before.findIndex(
    (p, i) => p.bounds.w > 0 && JSON.stringify(p.bounds) !== JSON.stringify(after[i].bounds),
  )
  expect(panel).toBeGreaterThanOrEqual(0)
  return { panel, before: before[panel].bounds, after: after[panel].bounds }
}

describe('setGridKeepingContent', () => {
  it('replaces the grid and re-expresses the pictures and balloons on a reshaped panel', () => {
    const moved = nudgedShippedGrid()
    const { panel, before, after } = reshapedPanel(moved)

    const cfg = { ...seedConfig(), images: [img(panel)], bubbles: [bubble(panel)] }
    const next = setGridKeepingContent(cfg, 'classic', 'landscape', moved, { w: W, h: H })

    expect(next.grids.classic.landscape).toEqual(moved)
    expectRectClose(imgRect(after, next.images[0]), imgRect(before, cfg.images[0]))
    expectRectClose(bubbleRect(after, next.bubbles[0]), bubbleRect(before, cfg.bubbles[0]))
    // Everything that is not content or the addressed grid rides along untouched.
    expect(next.patterns).toEqual(cfg.patterns)
    expect(next.chains).toEqual(cfg.chains)
    expect(next.grids.home).toEqual(cfg.grids.home)
  })
})

describe('resetGridKeepingContent', () => {
  it('undoes a drag exactly: reset right after an edit hands back the original framing', () => {
    const moved = nudgedShippedGrid()
    const { panel } = reshapedPanel(moved)
    const cfg = { ...seedConfig(), images: [img(panel)], bubbles: [bubble(panel)] }

    const dragged = setGridKeepingContent(cfg, 'classic', 'landscape', moved, { w: W, h: H })
    const back = resetGridKeepingContent(dragged, 'classic', 'landscape', { w: W, h: H })

    expect(back.grids.classic.landscape).toEqual(PANEL_GRIDS.classic.landscape)
    for (const field of ['left', 'top', 'width', 'height'] as const) {
      expect(back.images[0][field]).toBeCloseTo(cfg.images[0][field], 8)
    }
    for (const field of ['top', 'right', 'width'] as const) {
      expect(back.bubbles[0][field]).toBeCloseTo(cfg.bubbles[0][field], 8)
    }
  })
})
