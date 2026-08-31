// Which panel the pointer is over — geometry, not DOM hit-testing.
//
// Hover used to be onMouseEnter/onMouseLeave on each panel's element, and that element
// is the polygon's *bounding rectangle*: two panels either side of a slanted seam
// overlap by the whole triangle the slant cuts off, so inside the overlap the browser
// delivered the event to whichever rectangle stacked higher, and the seam the reader
// can see decided nothing. The point is tested against the panel polygons themselves
// instead; the rectangles stay what they always were — the boxes contents are placed
// against, never hit targets.
//
// Spilled ink then takes precedence, deliberately: a picture or balloon with `spill`
// is drawn past its panel's edge, so the pointer can sit on panel 1's ink while
// standing inside panel 2's polygon — and it is panel 1 that must light, because
// panel 1's ink is what is being pointed at.
//
// The same rule holds for the ink itself: a balloon is its outline, not its box. The
// element a balloon is drawn in is a rectangle around an ellipse, a tail and (for a
// thought bubble) a trail of puffs, and most of that rectangle is empty. A hover that
// treated the rectangle as the balloon kept the neighbour dark with the pointer
// visibly on its ground — so this module never tests a balloon's rectangle at all.
// Balloons are answered for by `overInk`, the renderer's own measurement of what it
// drew (see usePanelHover.ts).

import { imgRect, renderedImgRect } from './editor/transforms'
import type { ImgTransform } from './editor/types'
import type { PanelPoly, Rect, VpPt } from './panelGeometry'

/** Natural image sizes by src, as Layout records them (absent until loaded). */
type NatSizes = Record<string, { w: number; h: number }>

/** Whether `(x, y)` is inside the polygon, by even-odd ray casting. */
export function pointInPolygon(x: number, y: number, poly: VpPt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

/**
 * The box a spilled picture's ink can occupy, in viewport coordinates: the artwork's
 * rendered rect once its natural size is known, else the frame — the same fallback the
 * renderer draws while the load is pending. Unclamped by the panel on purpose, since
 * spill is exactly the flag that drops that clip.
 */
function spillImgRect(bounds: Rect, t: ImgTransform, natSizes: NatSizes): Rect {
  const frame = imgRect(bounds, t)
  const nat = natSizes[t.src]
  return nat && frame.w > 0 && frame.h > 0 ? renderedImgRect(frame, nat, t) : frame
}

/**
 * Where a picture is drawn, if it is drawn: the box its percentages are measured
 * against, or `null` for one the panel is not showing at all.
 *
 * This module knows nothing about phone calls, and should not: a panel that is drawing
 * one places half its pictures against half its box and leaves its ordinary ones off
 * screen entirely, and both facts belong to whoever decides which layout is up (Layout
 * hands this down; PanelImages applies the very same filter to the drawing). Without
 * it the probe measures a call figure against the whole panel and lights a panel from
 * ink that is not on screen — a hover answering for a picture the reader cannot see.
 */
export type ImgBoxFn = (t: ImgTransform, bounds: Rect) => Rect | null

/** Every picture drawn against its own panel's box — the page with no call up. */
const wholePanel: ImgBoxFn = (_t, bounds) => bounds

/**
 * Where a spilled picture's ink lands, or null for one this layout is not drawing.
 * Both steps below ask the same question, and both have to ask it through `imgBox`.
 */
type InkRectFn = (t: ImgTransform, bounds: Rect) => Rect | null

/** Whether any picture panel `current` spilled is under the point. Step 1's picture half. */
function overOwnSpill(
  x: number,
  y: number,
  current: number,
  bounds: Rect,
  images: ImgTransform[],
  ink: InkRectFn,
): boolean {
  return images.some(t => {
    if (t.panel !== current || !t.spill) return false
    const rect = ink(t, bounds)
    return rect !== null && inRect(x, y, rect)
  })
}

/** The panel whose spilled ink is topmost under the point, or null. Step 2. */
function spilledOwnerAt(
  x: number,
  y: number,
  polys: (PanelPoly | null)[],
  images: ImgTransform[],
  ink: InkRectFn,
): number | null {
  for (let k = images.length - 1; k >= 0; k--) {
    const t = images[k]
    const p = polys[t.panel]
    if (!t.spill || !p) continue
    const rect = ink(t, p.bounds)
    if (rect !== null && inRect(x, y, rect)) return t.panel
  }
  return null
}

/**
 * Which panel the pointer at `(x, y)` illuminates, or null over the gutter.
 *
 * Three questions, in the order the ink stacks:
 *
 * 1. **The hovered panel's own drawn ink keeps the hover.** Its balloons are revealed
 *    and its lift puts them (and its spilled pictures) above every neighbour, so a
 *    pointer that follows a balloon over the seam is still pointing at this panel — it
 *    does not flick to the panel whose polygon happens to lie underneath. `overInk`
 *    is the balloon half of that question: whether the point is on the outline of a
 *    balloon (or a connector tube) panel `current` has actually drawn, measured off
 *    the rendered SVG so it is exact for every balloon — the ones placed by their
 *    transforms and the rows a chain stamps at positions only the renderer knows.
 *    The moment the pointer leaves that outline, the hover is decided afresh below.
 * 2. **Any spilled picture claims its owner.** Pictures are visible whether or not
 *    their panel is lit, so ink hanging over a neighbour belongs to the panel that drew
 *    it. Later entries win ties, matching paint order.
 * 3. **Otherwise, the polygon under the point.** Panels tile, so at most one contains
 *    it; the gutter and the outer margin belong to none.
 *
 * Balloons of panels *not hovered* are hidden, which is why step 1 asks only about
 * `current`: invisible ink must not grab the pointer. A balloon without `spill` is
 * clipped to its polygon, so the polygon test already answers for every part of it a
 * reader can see — the probe skips those too.
 */
export function hoveredPanelAt(
  x: number,
  y: number,
  polys: (PanelPoly | null)[],
  images: ImgTransform[],
  natSizes: NatSizes,
  current: number | null,
  overInk?: (x: number, y: number, panel: number) => boolean,
  imgBox: ImgBoxFn = wholePanel,
): number | null {
  /** The rect a spilled picture's ink covers, or null when it is not drawn. */
  const inkRect: InkRectFn = (t, bounds) => {
    const box = imgBox(t, bounds)
    return box && spillImgRect(box, t, natSizes)
  }
  const cur = current == null ? null : polys[current]
  const keepsHover =
    cur != null &&
    current != null &&
    ((overInk?.(x, y, current) ?? false) ||
      overOwnSpill(x, y, current, cur.bounds, images, inkRect))
  if (keepsHover) return current
  const spilled = spilledOwnerAt(x, y, polys, images, inkRect)
  if (spilled !== null) return spilled
  const under = polys.findIndex(p => p != null && pointInPolygon(x, y, p.vp))
  return under >= 0 ? under : null
}
