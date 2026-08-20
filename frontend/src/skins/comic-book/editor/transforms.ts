import type { CSSProperties } from 'react'

import { BUBBLE_ASPECT } from '../bubbleBox'
import type { ImgTransform, BubbleTransform } from './types'

// ─── Interaction bounds (Phase 3) ───────────────────────────────────────────────

/**
 * Image zoom limits. Below 1 the image no longer fills the panel (objectFit:cover
 * leaves the Ben-Day dot background showing through) — intentional, so a panel image
 * can be shrunk as well as enlarged.
 */
export const IMG_SCALE = { min: 0.2, max: 4, step: 0.05 }
/** Bubble width limits, in % of the panel box. */
export const BUBBLE_W = { min: 15, max: 90, step: 1 }
/** Bubble rotation limits, in degrees. */
export const ROTATE = { min: -30, max: 30 }

/** Clamp `v` into the inclusive `[min, max]` range. */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * Pan the picture *inside* its frame by a px drag. This is the second of an image's
 * two framings: {@link dragImgFrame} moves the window, this slides the picture behind
 * it. They were the same gesture back when the window was the panel and could not move.
 */
export function dragImg(t: ImgTransform, dxPx: number, dyPx: number): ImgTransform {
  return { ...t, offsetX: t.offsetX + dxPx, offsetY: t.offsetY + dyPx }
}

/** Zoom an image around its centre by a wheel/handle delta, clamped to IMG_SCALE. */
export function scaleImg(t: ImgTransform, deltaScale: number): ImgTransform {
  return { ...t, scale: clamp(t.scale + deltaScale, IMG_SCALE.min, IMG_SCALE.max) }
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

/** CSS for the <img> inside the clip wrapper. */
export function imgTransformStyle(t: ImgTransform): CSSProperties {
  return {
    objectFit: 'cover',
    objectPosition: t.anchor,
    transform: `translate(${t.offsetX}px, ${t.offsetY}px) scale(${t.scale})`,
    transformOrigin: 'center center',
  }
}

/**
 * Map a CSS `object-position` anchor keyword pair (e.g. `'center bottom'`) to
 * fractional coordinates in [0, 1]: x → 0 left / 0.5 center / 1 right,
 * y → 0 top / 0.5 center / 1 bottom. Unknown/missing keywords fall back to 0.5.
 */
export function anchorToFractions(anchor: string): [number, number] {
  const frac = (k: string, lo: string, hi: string): number =>
    k === lo ? 0 : k === hi ? 1 : 0.5
  const [x = 'center', y = 'center'] = anchor.trim().split(/\s+/)
  return [frac(x, 'left', 'right'), frac(y, 'top', 'bottom')]
}

/**
 * Full-source framing style: render the *entire* source image (no cover cropping),
 * scaled and positioned so that at identity (scale 1 / offset 0) it is pixel-identical
 * to {@link imgTransformStyle}'s `object-fit: cover` box. This is the picture's real
 * geometry once its natural size is known: the frame's polygon clip supplies the
 * comic-panel crop, so panning slides the picture under the frame (re-framing it)
 * instead of moving a pre-cropped box — no source pixels are ever discarded. In edit
 * mode the selected image simply drops the clip, revealing the same geometry.
 *
 * `bounds` is the *frame* box, not the panel box: an inset picture covers its own
 * frame, which is the whole point of the frame being the picture's own.
 *
 * Geometry: the cover box (`bounds`) renders the natural image (`nat`) at
 * `coverScale = max(bw/nw, bh/nh)`; this draws the natural image at that same
 * scale (× the transform's zoom) and positions its centre where the cover content's
 * centre lands after `translate(offset) scale(t.scale)` about the box centre.
 */
export function fullImgStyle(
  bounds: { w: number; h: number },
  nat: { w: number; h: number },
  t: ImgTransform,
): CSSProperties {
  const { w: bw, h: bh } = bounds
  const { w: nw, h: nh } = nat
  const cover = Math.max(bw / nw, bh / nh)
  const fw = nw * cover
  const fh = nh * cover
  const [ax, ay] = anchorToFractions(t.anchor)
  // Cover content centre in box coords (before the panel transform).
  const cx = ax * (bw - fw) + fw / 2
  const cy = ay * (bh - fh) + fh / 2
  const ox = bw / 2
  const oy = bh / 2
  // Apply translate(offset) scale about the box centre, matching imgTransformStyle.
  const centerX = ox + t.offsetX + t.scale * (cx - ox)
  const centerY = oy + t.offsetY + t.scale * (cy - oy)
  return {
    position: 'absolute',
    left: centerX - nw / 2,
    top: centerY - nh / 2,
    width: nw,
    height: nh,
    // The natural size must be honoured verbatim — override any global
    // `img { max-width: 100% }` reset, which would otherwise cap the width to the
    // wrapper and collapse this geometry (image flies off-screen).
    maxWidth: 'none',
    maxHeight: 'none',
    objectFit: 'fill',
    transform: `scale(${cover * t.scale})`,
    transformOrigin: 'center center',
  }
}

/**
 * Style for the .cb-img-clip wrapper around a panel image. The panel's polygon
 * clip-path ({@link imgPanelClip}) is what crops the full-source image
 * ({@link fullImgStyle}) into a comic panel. `spill: true` drops the clip so the
 * picture pops out past the panel edge —
 * z-index 4 lifts it above the panel-outline SVG (z-index 3) so the frame lines
 * don't cross it (panels themselves are z-index:auto, so children escape into the
 * root stacking context). The editor's full-reveal does the same unclipping while
 * an image is selected.
 *
 * Deliberately the same rule a bubble gets from PanelBubbles: `spill` asks whether
 * this entity's ink may cross the *panel* edge, and means the same thing for both.
 */
export function imgClipStyle(spill: boolean, reveal: boolean, clip: string): CSSProperties {
  return spill || reveal
    ? { clipPath: 'none', overflow: 'visible', zIndex: 4 }
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
// A picture's frame is its own rectangle over the panel box, in % — not the panel
// polygon it used to borrow. That is what lets a panel hold two pictures, and what
// makes dragging one move its window instead of sliding the picture under a window
// that never moved.
//
// The frame is geometry and nothing else: where the picture sits and how big it
// renders, exactly as `top`/`right`/`width` are for a bubble. It is not a shape, it
// draws no ink, and it does no cropping — the panel does the cropping, or nothing
// does when `spill` is on.

/** Frame size limits, in % of the panel box. */
export const IMG_FRAME = { min: 5, max: 400, step: 1 }

/** Convert a viewport-coord polygon to a CSS `polygon()`, relative to an origin. */
export function toClipPath(pts: [number, number][], ox: number, oy: number): string {
  return `polygon(${pts.map(([x, y]) => `${x - ox}px ${y - oy}px`).join(', ')})`
}

/**
 * A picture's frame in coordinates relative to its panel element — which is what the
 * absolutely-positioned clip wrapper needs, since the panel element is itself placed at
 * the panel's bounds.
 */
export function imgFrameBox(
  bounds: { w: number; h: number },
  t: Pick<ImgTransform, 'left' | 'top' | 'width' | 'height'>,
): { x: number; y: number; w: number; h: number } {
  return {
    x: (t.left / 100) * bounds.w,
    y: (t.top / 100) * bounds.h,
    w: (t.width / 100) * bounds.w,
    h: (t.height / 100) * bounds.h,
  }
}

/**
 * The same frame in viewport coordinates — the editor's hit target and selection
 * outline. Shared with {@link imgFrameBox} on purpose: when the box you can drag and
 * the box that gets drawn disagree, the picture moves somewhere you did not click.
 */
export function imgRect(
  bounds: { x: number; y: number; w: number; h: number },
  t: Pick<ImgTransform, 'left' | 'top' | 'width' | 'height'>,
): { x: number; y: number; w: number; h: number } {
  const box = imgFrameBox(bounds, t)
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
  t: Pick<ImgTransform, 'left' | 'top' | 'width' | 'height'>,
): string {
  if (vp.length === 0) return 'none'
  const rect = imgRect(bounds, t)
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
 * Grow/shrink a picture's frame by a delta in % of the panel box, both axes at once —
 * the keyboard's `+`/`-`, where there is no drag direction to take two deltas from.
 */
export function sizeImgFrame(t: ImgTransform, deltaPct: number): ImgTransform {
  return {
    ...t,
    width: clamp(t.width + deltaPct, IMG_FRAME.min, IMG_FRAME.max),
    height: clamp(t.height + deltaPct, IMG_FRAME.min, IMG_FRAME.max),
  }
}

/**
 * Resize a picture's frame from its bottom-right corner by a px handle drag. The top
 * left stays put, so the handle tracks the pointer.
 */
export function resizeImgFrame(
  t: ImgTransform,
  dWidthPx: number,
  dHeightPx: number,
  panelW: number,
  panelH: number,
): ImgTransform {
  if (panelW <= 0 || panelH <= 0) return t
  return {
    ...t,
    width: clamp(t.width + (dWidthPx / panelW) * 100, IMG_FRAME.min, IMG_FRAME.max),
    height: clamp(t.height + (dHeightPx / panelH) * 100, IMG_FRAME.min, IMG_FRAME.max),
  }
}

/** Inline style placing the .cb-img-clip wrapper on its frame within the panel. */
export function imgFrameStyle(
  bounds: { w: number; h: number },
  t: Pick<ImgTransform, 'left' | 'top' | 'width' | 'height'>,
): CSSProperties {
  const box = imgFrameBox(bounds, t)
  return { position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }
}
