import { inRoles } from './callSceneRoles'
import type { CallRole, ImgTransform } from './editor/types'

// Which picture is in front of which. Renderer-owned, like callSceneRoles.ts: the page
// draws this order and the editor only edits the number behind it. Kept out of
// transforms.ts because it is the one part of a picture's placement that is not
// geometry — nothing here measures a box.
//
// **Depth is paint order, not a z-index.** Pictures are ordered by rendering them in
// depth order, and two positioned siblings with no z-index paint in document order, so a
// picture in front is simply a picture written later. A z-index would have to be a number
// in the page's *single* stacking context — panels deliberately create none, so a
// spilling picture can escape over the ink (comic-book.css) — where the free integers
// between the panel ink (3) and the balloons (5) are exactly one. Ordering the DOM needs
// none of them and cannot collide with any of them.
//
// The consequence, and the thing to tell an author: **`spill` still decides the layer.**
// A spilling picture is lifted over the panel's ink and a clipped one is not, so depth
// orders pictures *within* each of those two groups and never across them. Two pictures
// that must stack in a chosen order — a hand over the notepad it is writing on — want the
// same `spill` setting as each other, and then depth is the whole of it.

/** Backmost depth an author can choose; the default, so an unset picture stays put. */
export const DEPTH_MIN = 0

/** Frontmost. Ten bands is more stacking than a panel has ever wanted. */
export const DEPTH_MAX = 9

/** Range for the inspector's field, in the shape `ROW_COUNT` and `FONT_SCALE` use. */
export const DEPTH = { min: DEPTH_MIN, max: DEPTH_MAX, step: 1 }

/**
 * A depth pulled back into the range, whatever a hand-edited config or an older payload
 * put there. Non-finite reads as {@link DEPTH_MIN}: a `NaN` in a comparator makes `sort`
 * order by nothing at all, which would scramble the page rather than fail.
 */
export function clampDepth(z: number): number {
  if (!Number.isFinite(z)) return DEPTH_MIN
  return Math.min(Math.max(Math.round(z), DEPTH_MIN), DEPTH_MAX)
}

/** A picture with the index it holds in the config — paint order moves, indices do not. */
export interface DrawnImage {
  img: ImgTransform
  /**
   * Index into `EditorConfig.images`. Carried rather than re-derived because it is what
   * selection, the inspector and Save all name: sorting the array itself would renumber
   * the author's pictures on every depth change, and hydration merges a saved payload
   * over the shipped entry *at the same index*.
   */
  index: number
}

/**
 * Every picture, back to front.
 *
 * The sort is stable (ES2019 guarantees it), which is what makes depth additive rather
 * than disruptive: pictures at equal depth keep the order the config lists them in, so a
 * layout whose pictures are all at the default draws exactly as it did before depth
 * existed.
 */
export function inDepthOrder(images: readonly ImgTransform[]): DrawnImage[] {
  return images
    .map((img, index) => ({ img, index }))
    .sort((a, b) => clampDepth(a.img.z) - clampDepth(b.img.z))
}

/**
 * The pictures one panel draws in one of its layouts, back to front.
 *
 * Filtered after the sort rather than before it for no reason but clarity — the sort is
 * stable either way — and both filters are the panel's existing ones: `panel` names the
 * slot, and `callRoles` picks the ordinary layout (`null`) or the roles of a call.
 */
export function panelDrawOrder(
  images: readonly ImgTransform[],
  panel: number,
  callRoles: CallRole[] | null,
): DrawnImage[] {
  return inDepthOrder(images).filter(
    ({ img }) => img.panel === panel && inRoles(img.call, callRoles),
  )
}
