import { gridPolys } from '../panelGeometry'
import type { Rect } from '../panelGeometry'
import { setGrid } from './configSeed'
import { PANEL_GRIDS } from './layoutConfig'
import type { EditorConfig, ImgTransform, LayoutKind, PanelGrid, PanelPage } from './types'

// Keeping pictures still while the panels around them are reshaped.
//
// A picture's frame is stored in % of its panel's bounding box, so replacing a grid
// moves every box and would drag each picture along with it — shift it, and rescale it,
// because the contain fit follows the frame. But the panel is only the *window* a
// picture is seen through: reshaping the window must not move the picture behind it.
// These ops rewrite the stored percentages against the new box so the frame's on-screen
// rectangle is unchanged; the polygon clip alone follows the seam being dragged.
//
// Nothing else on the picture needs rewriting: `offsetX`/`offsetY` are px, and `scale`,
// the anchor and any projected table or number pad are all measured against the frame —
// which keeps the same pixels, so they render identically.

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
 * Every picture re-expressed from one grid's panel boxes to another's, measured at the
 * given viewport — the same `window.innerWidth/innerHeight` the renderer draws with,
 * because % of a box only names pixels once the box does.
 *
 * A picture is left alone (same reference) when there is nothing sound to remap
 * against: its panel's box did not change, either box is degenerate (an empty ring —
 * the panel lives on the other page — or a collapsed panel), or the viewport has no
 * size yet.
 */
export function remapImagesToGrid(
  images: ImgTransform[],
  from: PanelGrid,
  to: PanelGrid,
  w: number,
  h: number,
): ImgTransform[] {
  if (w <= 0 || h <= 0) return images
  const fromPolys = gridPolys(from, w, h)
  const toPolys = gridPolys(to, w, h)
  return images.map(img => {
    const a = fromPolys[img.panel]?.bounds
    const b = toPolys[img.panel]?.bounds
    if (!a || !b || a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return img
    if (sameRect(a, b)) return img
    return remapImgFrame(img, a, b)
  })
}

/**
 * {@link setGrid}, with the pictures held still: replace one page's grid for one
 * breakpoint and rewrite every affected picture's frame against the new panel boxes.
 * This is what a shapes-mode edit means — the seams move, the content does not.
 */
export function setGridKeepingImages(
  config: EditorConfig,
  page: PanelPage,
  kind: LayoutKind,
  grid: PanelGrid,
  viewport: { w: number; h: number },
): EditorConfig {
  const from = config.grids[page][kind]
  const next = setGrid(config, page, kind, grid)
  next.images = remapImagesToGrid(next.images, from, grid, viewport.w, viewport.h)
  return next
}

/**
 * Restore one page's grid for one breakpoint to the shipped default, holding the
 * pictures still. "Reset shapes" resets the shapes: content the author has placed
 * stays where it was put, and a reset issued right after a drag hands back the exact
 * percentages the drag rewrote, because the remap is its own inverse.
 */
export function resetGridKeepingImages(
  config: EditorConfig,
  page: PanelPage,
  kind: LayoutKind,
  viewport: { w: number; h: number },
): EditorConfig {
  return setGridKeepingImages(config, page, kind, PANEL_GRIDS[page][kind], viewport)
}
