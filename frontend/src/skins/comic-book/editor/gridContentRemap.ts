import { gridPolys } from '../panelGeometry'
import type { Rect } from '../panelGeometry'
import { setGrid, shippedGridFor } from './configSeed'
import type {
  BubbleTransform,
  EditorConfig,
  ImgTransform,
  LayoutKind,
  PanelGrid,
  PanelPage,
} from './types'

// Keeping content still while the panels around it are reshaped.
//
// A picture's frame and a bubble's placement are both stored in % of their panel's
// bounding box, so replacing a grid moves every box and would drag the content along
// with it — shift it, and rescale it, because both a picture's contain fit and a
// bubble's height follow their width. But the panel is only the *window* its content is
// seen through: reshaping the window must not move what is behind it.
//
// These ops rewrite the stored percentages against the new box so each item's on-screen
// rectangle is unchanged; the polygon clip alone follows the seam being dragged.
//
// Nothing else needs rewriting. A picture's `offsetX`/`offsetY` are px, and its `scale`,
// anchor and any projected table or number pad are measured against the frame; a
// bubble's `rotate` is degrees and its lettering scales with its box. All of them keep
// the same pixels, so they render identically.

/** Exact equality is enough: an untouched panel's box is recomputed from the same
    vertices by the same arithmetic, so it comes back bit-identical. */
function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

/**
 * Re-express one picture's frame, unchanged on screen, as % of a different panel box.
 * The result is deliberately unclamped: a panel shrunk under a picture can push its
 * frame past the inspector's usual ranges, and clamping here would move the picture —
 * the one thing this function exists not to do.
 */
export function remapImgFrame(t: ImgTransform, from: Rect, to: Rect): ImgTransform {
  const x = from.x + (t.left / 100) * from.w
  const y = from.y + (t.top / 100) * from.h
  const w = (t.width / 100) * from.w
  const h = (t.height / 100) * from.h
  return {
    ...t,
    left: ((x - to.x) / to.w) * 100,
    top: ((y - to.y) / to.h) * 100,
    width: (w / to.w) * 100,
    height: (h / to.h) * 100,
  }
}

/**
 * Re-express one bubble's placement, unchanged on screen, as % of a different panel box.
 *
 * A bubble is anchored by its **right** edge and has no stored height — the outline's
 * viewBox gives it a fixed aspect, so holding the width in px holds the whole balloon,
 * its lettering and its tail. Unclamped for the same reason as the picture frame above:
 * `BUBBLE_W` bounds the widths the inspector will *author*, and forcing a reshaped
 * balloon back inside them would resize the very thing being held still.
 */
export function remapBubbleBox(t: BubbleTransform, from: Rect, to: Rect): BubbleTransform {
  const w = (t.width / 100) * from.w
  const rightX = from.x + from.w - (t.right / 100) * from.w
  const y = from.y + (t.top / 100) * from.h
  return {
    ...t,
    top: ((y - to.y) / to.h) * 100,
    right: ((to.x + to.w - rightX) / to.w) * 100,
    width: (w / to.w) * 100,
  }
}

/**
 * One panel-indexed array re-expressed from one grid's panel boxes to another's,
 * measured at the given viewport — the same `window.innerWidth/innerHeight` the renderer
 * draws with, because % of a box only names pixels once the box does.
 *
 * An item is left alone (same reference) when there is nothing sound to remap against:
 * its panel's box did not change, either box is degenerate (an empty ring — the panel
 * lives on the other page — or a collapsed panel), or the viewport has no size yet.
 */
function remapPanelItems<T extends { panel: number }>(
  items: T[],
  fromPolys: ReturnType<typeof gridPolys>,
  toPolys: ReturnType<typeof gridPolys>,
  remap: (item: T, from: Rect, to: Rect) => T,
): T[] {
  return items.map(item => {
    const a = fromPolys[item.panel]?.bounds
    const b = toPolys[item.panel]?.bounds
    if (!a || !b || a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return item
    if (sameRect(a, b)) return item
    return remap(item, a, b)
  })
}

/** Every picture held still across a grid replacement. See {@link remapPanelItems}. */
export function remapImagesToGrid(
  images: ImgTransform[],
  from: PanelGrid,
  to: PanelGrid,
  w: number,
  h: number,
): ImgTransform[] {
  if (w <= 0 || h <= 0) return images
  return remapPanelItems(images, gridPolys(from, w, h), gridPolys(to, w, h), remapImgFrame)
}

/**
 * Every bubble held still across a grid replacement. See {@link remapPanelItems}.
 *
 * Chains need nothing of their own: a chain entry carries behaviour (does it grow, how
 * fast, what transcript) and no geometry, and its column is laid out from the `top` of
 * the balloons that are its slots — so holding those still holds the thread still.
 */
export function remapBubblesToGrid(
  bubbles: BubbleTransform[],
  from: PanelGrid,
  to: PanelGrid,
  w: number,
  h: number,
): BubbleTransform[] {
  if (w <= 0 || h <= 0) return bubbles
  return remapPanelItems(bubbles, gridPolys(from, w, h), gridPolys(to, w, h), remapBubbleBox)
}

/**
 * {@link setGrid}, with the content held still: replace one page's grid for one
 * breakpoint and rewrite every affected picture and bubble against the new panel boxes.
 * This is what a shapes-mode edit means — the seams move, the content does not.
 */
export function setGridKeepingContent(
  config: EditorConfig,
  page: PanelPage,
  kind: LayoutKind,
  grid: PanelGrid,
  viewport: { w: number; h: number },
): EditorConfig {
  const from = config.grids[page][kind]
  const next = setGrid(config, page, kind, grid)
  next.images = remapImagesToGrid(next.images, from, grid, viewport.w, viewport.h)
  next.bubbles = remapBubblesToGrid(next.bubbles, from, grid, viewport.w, viewport.h)
  return next
}

/**
 * Restore one page's grid for one breakpoint to the shipped default, holding the
 * content still. "Reset shapes" resets the shapes: content the author has placed stays
 * where it was put, and a reset issued right after a drag hands back the exact
 * percentages the drag rewrote, because the remap is its own inverse.
 */
export function resetGridKeepingContent(
  config: EditorConfig,
  page: PanelPage,
  kind: LayoutKind,
  viewport: { w: number; h: number },
): EditorConfig {
  return setGridKeepingContent(
    config, page, kind, shippedGridFor(page, kind, config.panels.length), viewport,
  )
}
