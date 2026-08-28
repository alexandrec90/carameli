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

import { bubbleRect, imgRect, renderedImgRect } from './editor/transforms'
import type { BubbleTransform, ImgTransform } from './editor/types'
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
 * Which panel the pointer at `(x, y)` illuminates, or null over the gutter.
 *
 * Three questions, in the order the ink stacks:
 *
 * 1. **The hovered panel's own spill keeps the hover.** Its balloons are revealed and
 *    its lift puts them (and its spilled pictures) above every neighbour, so a pointer
 *    that follows a balloon over the seam is still pointing at this panel — it does not
 *    flick to the panel whose polygon happens to lie underneath.
 * 2. **Any spilled picture claims its owner.** Pictures are visible whether or not
 *    their panel is lit, so ink hanging over a neighbour belongs to the panel that drew
 *    it. Later entries win ties, matching paint order.
 * 3. **Otherwise, the polygon under the point.** Panels tile, so at most one contains
 *    it; the gutter and the outer margin belong to none.
 *
 * Balloons of panels *not hovered* are hidden, which is why step 1 asks only about
 * `current`: invisible ink must not grab the pointer. A balloon without `spill` is
 * clipped to its polygon, so the polygon test already answers for every part of it a
 * reader can see. Chained balloons are approximated by their template's box.
 */
export function hoveredPanelAt(
  x: number,
  y: number,
  polys: (PanelPoly | null)[],
  images: ImgTransform[],
  bubbles: BubbleTransform[],
  natSizes: NatSizes,
  current: number | null,
): number | null {
  const cur = current == null ? null : polys[current]
  if (current != null && cur) {
    const overOwnSpill =
      bubbles.some(b =>
        b.panel === current && b.spill && inRect(x, y, bubbleRect(cur.bounds, b))) ||
      images.some(t =>
        t.panel === current && t.spill && inRect(x, y, spillImgRect(cur.bounds, t, natSizes)))
    if (overOwnSpill) return current
  }
  for (let k = images.length - 1; k >= 0; k--) {
    const t = images[k]
    const p = polys[t.panel]
    if (!t.spill || !p) continue
    if (inRect(x, y, spillImgRect(p.bounds, t, natSizes))) return t.panel
  }
  const under = polys.findIndex(p => p != null && pointInPolygon(x, y, p.vp))
  return under >= 0 ? under : null
}
