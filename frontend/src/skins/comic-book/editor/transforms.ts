import type { CSSProperties } from 'react'

import { BUBBLE_ASPECT } from '../bubbleBox'
import type { ImgTransform, BubbleTransform } from './types'

// ─── Interaction bounds (Phase 3) ───────────────────────────────────────────────

/** Bubble width limits, in % of the panel box. */
export const BUBBLE_W = { min: 15, max: 90, step: 1 }
/** Bubble rotation limits, in degrees. */
export const ROTATE = { min: -30, max: 30 }

/** Clamp `v` into the inclusive `[min, max]` range. */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * Drag a bubble: px delta → % of the panel box. The bubble is anchored by its
 * `right` offset, so dragging right (dx > 0) *reduces* `right`; `top` grows with dy.
 */
export function dragBubble(
  b: BubbleTransform,
  dxPx: number,
  dyPx: number,
  panelW: number,
  panelH: number,
): BubbleTransform {
  return {
    ...b,
    right: b.right - (dxPx / panelW) * 100,
    top: b.top + (dyPx / panelH) * 100,
  }
}

/** Grow/shrink a bubble by a width delta in % of the panel box, clamped to BUBBLE_W. */
export function scaleBubble(b: BubbleTransform, deltaWidthPct: number): BubbleTransform {
  return { ...b, width: clamp(b.width + deltaWidthPct, BUBBLE_W.min, BUBBLE_W.max) }
}

/** Resize a bubble by a px handle delta → width %, clamped to BUBBLE_W. */
export function resizeBubble(b: BubbleTransform, dWidthPx: number, panelW: number): BubbleTransform {
  return scaleBubble(b, (dWidthPx / panelW) * 100)
}

/** Rotate a bubble by a degree delta, clamped to ROTATE. */
export function rotateBubble(b: BubbleTransform, deltaDeg: number): BubbleTransform {
  return { ...b, rotate: clamp(b.rotate + deltaDeg, ROTATE.min, ROTATE.max) }
}

// ─── CSS builders ────────────────────────────────────────────────────────────────

/**
 * Style for the <img> inside the clip wrapper: fill the frame, and nothing else.
 *
 * There is no `object-fit: cover` here and no transform, because the frame is built
 * to the source's own aspect ratio ({@link imgFrameBox}) — so filling it *is* drawing
 * the whole picture at its true proportions. `contain` rather than `fill` only so the
 * one frame before the natural size is known letterboxes instead of stretching.
 *
 * What used to be here — a cover box, an `object-position` anchor, and a
 * translate/scale pan-and-zoom on top — existed to choose which part of the picture
 * survived being forced into a box of the wrong shape. Nothing is forced any more,
 * so there is nothing left to choose: moving the frame moves the picture, resizing
 * the frame resizes the picture, and no source pixel is ever discarded.
 */
export function imgFillStyle(): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    // The natural size must not cap the box — a global `img { max-width: 100% }`
    // reset would otherwise shrink an enlarged picture back to its source width.
    maxWidth: 'none',
    maxHeight: 'none',
    objectFit: 'contain',
  }
}

/**
 * Style for the .cb-img-clip wrapper around a panel image.
 *
 * `overflow: hidden` is unconditional and is now only a guard: the picture is built
 * to fill this box exactly, so there is nothing to overflow. It stays because a
 * wrapper that can be overflowed by one frame's worth of stale geometry (a resize
 * between load and layout, say) would flash the picture outside its own outline.
 *
 * The panel polygon ({@link imgPanelClip}) is the crop `spill` governs, and it is
 * the only one: `spill: true` drops it so the picture crosses the panel edge, with
 * z-index 4 lifting it above the panel-outline SVG (z-index 3) so the frame lines
 * don't cross it (panels themselves are z-index:auto, so children escape into the
 * root stacking context).
 *
 * Deliberately the same rule a bubble gets from PanelBubbles: `spill` asks whether
 * this entity's ink may cross the *panel* edge, and means the same thing for both.
 * Selection is not part of it — a bubble does not redraw when you click it, and
 * neither does a picture.
 */
export function imgClipStyle(spill: boolean, clip: string): CSSProperties {
  return spill
    ? { clipPath: 'none', overflow: 'hidden', zIndex: 4 }
    : { clipPath: clip, overflow: 'hidden' }
}

/**
 * On-screen box of a bubble, given the bounds of the panel it belongs to.
 * `top`/`right`/`width` are percentages of that panel box, and the height follows the
 * bubble's fixed aspect ratio — which is what
 * the DOM's `height: auto` resolves to, since the outline SVG carries a viewBox.
 *
 * Shared deliberately: the renderer needs it to aim connector tubes and the editor
 * needs it for the hit target and selection outline. When those two disagreed, a
 * bubble you could click was not the bubble a tube pointed at.
 */
export function bubbleRect(
  bounds: { x: number; y: number; w: number; h: number },
  t: Pick<BubbleTransform, 'top' | 'right' | 'width'>,
): { x: number; y: number; w: number; h: number } {
  const w = (t.width / 100) * bounds.w
  const rightX = bounds.x + bounds.w - (t.right / 100) * bounds.w
  return {
    x: rightX - w,
    y: bounds.y + (t.top / 100) * bounds.h,
    w,
    h: w * BUBBLE_ASPECT,
  }
}

/** Inline style for the .cb-panel-bubble wrapper (overrides the CSS defaults). */
export function bubbleStyle(b: BubbleTransform): CSSProperties {
  return {
    top: `${b.top}%`,
    right: `${b.right}%`,
    width: `${b.width}%`,
    // rotate is applied via the existing transform on .cb-panel-bubble, driven by
    // this custom property so the hover scale animation stays data-driven.
    ['--cb-bubble-rot' as string]: `${b.rotate}deg`,
  } as CSSProperties
}

// Serialization back to layoutConfig.ts lives in ./serialize.ts.

// ─── Image frames ────────────────────────────────────────────────────────────────
// A picture's frame is its own rectangle over the panel box — not the panel polygon
// it used to borrow. That is what lets a panel hold two pictures, and what makes
// dragging one move its window instead of sliding the picture under a window that
// never moved.
//
// The frame is geometry alone: it draws no ink and it does no cropping. The panel
// does the cropping, or nothing does when `spill` is on.
//
// Only `left`/`top`/`width` are authored. The height follows the *source's* aspect
// ratio, exactly as a bubble's height follows BUBBLE_ASPECT — which is what makes the
// frame the picture's true outline rather than a window cut through it. An authored
// height can be any shape, and every shape but one crops: the eight shipped pictures
// showed between 38% and 98% of their source depending on how their panel happened to
// be proportioned, so no two were framed alike and the editor's selection outline was
// the crop rather than the picture.

/** Frame width limits, in % of the panel box. */
export const IMG_FRAME = { min: 5, max: 400, step: 1 }

/**
 * Aspect ratio (w / h) used for a picture whose source has not loaded yet, so a frame
 * always has a defined shape. Square is arbitrary and never seen: the page stays
 * behind its loading sheet until every picture has settled, and the frame snaps to the
 * real ratio on the load event.
 */
export const IMG_ASPECT_FALLBACK = 1

/** A source's aspect ratio (w / h), or {@link IMG_ASPECT_FALLBACK} before it loads. */
export function imgAspect(nat: { w: number; h: number } | undefined): number {
  return nat && nat.w > 0 && nat.h > 0 ? nat.w / nat.h : IMG_ASPECT_FALLBACK
}

/** Convert a viewport-coord polygon to a CSS `polygon()`, relative to an origin. */
export function toClipPath(pts: [number, number][], ox: number, oy: number): string {
  return `polygon(${pts.map(([x, y]) => `${x - ox}px ${y - oy}px`).join(', ')})`
}

/**
 * A picture's frame in coordinates relative to its panel element — which is what the
 * absolutely-positioned clip wrapper needs, since the panel element is itself placed at
 * the panel's bounds.
 *
 * `aspect` is the *source's* ratio, from {@link imgAspect}: the width is authored and
 * the height is whatever that width implies for this picture. Hand it the same value
 * the renderer used, or the outline stops describing the picture.
 */
export function imgFrameBox(
  bounds: { w: number; h: number },
  t: Pick<ImgTransform, 'left' | 'top' | 'width'>,
  aspect: number,
): { x: number; y: number; w: number; h: number } {
  const w = (t.width / 100) * bounds.w
  return {
    x: (t.left / 100) * bounds.w,
    y: (t.top / 100) * bounds.h,
    w,
    h: w / (aspect > 0 ? aspect : IMG_ASPECT_FALLBACK),
  }
}

/**
 * The same frame in viewport coordinates — the editor's hit target and selection
 * outline. Shared with {@link imgFrameBox} on purpose: when the box you can drag and
 * the box that gets drawn disagree, the picture moves somewhere you did not click.
 */
export function imgRect(
  bounds: { x: number; y: number; w: number; h: number },
  t: Pick<ImgTransform, 'left' | 'top' | 'width'>,
  aspect: number,
): { x: number; y: number; w: number; h: number } {
  const box = imgFrameBox(bounds, t, aspect)
  return { x: bounds.x + box.x, y: bounds.y + box.y, w: box.w, h: box.h }
}

/**
 * The crop a picture gets while `spill` is off: the panel's own polygon, as a
 * `clip-path` relative to the picture's frame — which is where the clip wrapper is
 * placed, so the shape lands on the picture rather than beside it.
 *
 * The *panel's* polygon, at its true size. Not a copy of it scaled into the frame,
 * which is what shipped and is the whole of the reported bug: a frame wider than its
 * panel carried the crop out into the gutter with it, so a picture with "allow spill"
 * unchecked still spilled, and the wider the author dragged the frame the further it
 * escaped. Cropping to the panel makes the checkbox mean what it says, and makes it
 * mean for a picture exactly what it already meant for a bubble — may this entity's
 * ink cross the panel edge?
 *
 * A panel with no polygon (first paint, before layout) has no shape to cut to, so this
 * returns `none` rather than an empty `polygon()` that would hide the picture entirely.
 */
export function imgPanelClip(
  vp: [number, number][],
  bounds: { x: number; y: number; w: number; h: number },
  t: Pick<ImgTransform, 'left' | 'top' | 'width'>,
  aspect: number,
): string {
  if (vp.length === 0) return 'none'
  const rect = imgRect(bounds, t, aspect)
  return toClipPath(vp, rect.x, rect.y)
}

/** Move a picture's frame by a px drag → % of the panel box. */
export function dragImgFrame(
  t: ImgTransform,
  dxPx: number,
  dyPx: number,
  panelW: number,
  panelH: number,
): ImgTransform {
  if (panelW <= 0 || panelH <= 0) return t
  return {
    ...t,
    left: t.left + (dxPx / panelW) * 100,
    top: t.top + (dyPx / panelH) * 100,
  }
}

/**
 * Grow/shrink a picture by a width delta in % of the panel box, clamped to IMG_FRAME.
 * One axis, because there is only one: the height is the source's to decide.
 */
export function sizeImgFrame(t: ImgTransform, deltaPct: number): ImgTransform {
  return { ...t, width: clamp(t.width + deltaPct, IMG_FRAME.min, IMG_FRAME.max) }
}

/**
 * Resize a picture's frame from its bottom-right corner by a px handle drag. Only the
 * horizontal component counts — the height follows the source — so the handle tracks
 * the pointer along x and the picture keeps its proportions. The top left stays put.
 */
export function resizeImgFrame(t: ImgTransform, dWidthPx: number, panelW: number): ImgTransform {
  if (panelW <= 0) return t
  return sizeImgFrame(t, (dWidthPx / panelW) * 100)
}

/** Inline style placing the .cb-img-clip wrapper on its frame within the panel. */
export function imgFrameStyle(
  bounds: { w: number; h: number },
  t: Pick<ImgTransform, 'left' | 'top' | 'width'>,
  aspect: number,
): CSSProperties {
  const box = imgFrameBox(bounds, t, aspect)
  return { position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }
}
