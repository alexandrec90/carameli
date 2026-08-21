import type { CSSProperties } from 'react'

import { BUBBLE_ASPECT } from '../bubbleBox'
import type { ImgTransform, BubbleTransform } from './types'

// ─── Interaction bounds (Phase 3) ───────────────────────────────────────────────

/**
 * Image zoom limits. At 1 the whole image fits inside its frame (contain), with the
 * Ben-Day dot background showing through around it; above 1 it zooms toward a crop.
 * Both directions are intentional — shrink as well as enlarge.
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
    objectFit: 'contain',
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
 * The contain-fit geometry every full-source view derives from. The box (`bounds`)
 * renders the natural image (`nat`) at `fit = min(bw/nw, bh/nh)` — the whole image
 * visible, anchored inside the box — then `translate(offset) scale(t.scale)` is
 * applied about the box centre, matching {@link imgTransformStyle}. `centerX`/`centerY`
 * are where the image's centre lands, in box coordinates; `fit` excludes the
 * transform's own zoom.
 *
 * One function, two consumers ({@link fullImgStyle}, {@link renderedImgRect}), so the
 * picture that is drawn and the border drawn around it cannot disagree.
 */
function containGeometry(
  bounds: { w: number; h: number },
  nat: { w: number; h: number },
  t: ImgTransform,
): { fit: number; centerX: number; centerY: number } {
  const { w: bw, h: bh } = bounds
  const { w: nw, h: nh } = nat
  const fit = Math.min(bw / nw, bh / nh)
  const fw = nw * fit
  const fh = nh * fit
  const [ax, ay] = anchorToFractions(t.anchor)
  // Contained content centre in box coords (before the panel transform).
  const cx = ax * (bw - fw) + fw / 2
  const cy = ay * (bh - fh) + fh / 2
  const ox = bw / 2
  const oy = bh / 2
  return {
    fit,
    centerX: ox + t.offsetX + t.scale * (cx - ox),
    centerY: oy + t.offsetY + t.scale * (cy - oy),
  }
}

/**
 * Full-source framing style: render the *entire* source image, scaled and positioned
 * so that at identity (scale 1 / offset 0) it is pixel-identical to
 * {@link imgTransformStyle}'s `object-fit: contain` box. This is the picture's real
 * geometry once its natural size is known: the image keeps its own edges — the
 * "original borders" of the artwork — and the frame's polygon clip only ever cuts in
 * when a zoom or pan pushes the picture past its frame. In edit mode the selected
 * image simply drops the clip, revealing the same geometry.
 *
 * `bounds` is the *frame* box, not the panel box: an inset picture fits its own
 * frame, which is the whole point of the frame being the picture's own.
 *
 * Geometry: the contain box (`bounds`) renders the natural image (`nat`) at
 * `fit = min(bw/nw, bh/nh)` — the whole image visible, anchored inside the box;
 * this draws the natural image at that same scale (× the transform's zoom) and
 * positions its centre where the contained content's centre lands after
 * `translate(offset) scale(t.scale)` about the box centre.
 *
 * `min`, not `max`: the cover fit this replaces filled the frame by cropping
 * whichever image dimension overshot it — a wide panel beheaded a tall picture, and
 * the panel's ink border then cut across the artwork instead of framing it.
 */
export function fullImgStyle(
  bounds: { w: number; h: number },
  nat: { w: number; h: number },
  t: ImgTransform,
): CSSProperties {
  const { w: nw, h: nh } = nat
  const { fit, centerX, centerY } = containGeometry(bounds, nat, t)
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
    transform: `scale(${fit * t.scale})`,
    transformOrigin: 'center center',
  }
}

/**
 * Style for the .cb-img-clip wrapper around a panel image. The frame's polygon
 * clip-path ({@link imgFramePoly}) is what crops the full-source image
 * ({@link fullImgStyle}) into a comic panel. `spill: true` drops the clip so the
 * image pops out of its frame —
 * z-index 4 lifts it above the panel-outline SVG (z-index 3) so the frame lines
 * don't cross it (panels themselves are z-index:auto, so children escape into the
 * root stacking context). The editor's full-reveal does the same unclipping while
 * an image is selected.
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
 * The frame's crop shape in viewport coordinates: the panel's own polygon, normalised
 * against the panel box and scaled into the frame rect.
 *
 * Taking the panel's shape rather than a plain rectangle is what keeps this a comic.
 * At the default full-panel frame it is the panel polygon exactly — a picture that has
 * not been moved crops as it always did — and an inset picture reads as a small panel
 * of its own, with the same slanted gutters as the grid around it.
 *
 * A zero-size panel box (first paint, before layout) has no shape to scale, so this
 * returns no points rather than dividing by zero.
 */
export function imgFramePoints(
  vp: [number, number][],
  bounds: { x: number; y: number; w: number; h: number },
  t: Pick<ImgTransform, 'left' | 'top' | 'width' | 'height'>,
): [number, number][] {
  if (bounds.w <= 0 || bounds.h <= 0) return []
  const rect = imgRect(bounds, t)
  return vp.map(
    ([x, y]) =>
      [
        rect.x + ((x - bounds.x) / bounds.w) * rect.w,
        rect.y + ((y - bounds.y) / bounds.h) * rect.h,
      ] as [number, number],
  )
}

/**
 * {@link imgFramePoints} as a `clip-path` relative to the frame wrapper — which is where
 * the wrapper is placed, so the shape lands on the picture rather than beside it.
 */
export function imgFramePoly(
  vp: [number, number][],
  bounds: { x: number; y: number; w: number; h: number },
  t: Pick<ImgTransform, 'left' | 'top' | 'width' | 'height'>,
): string {
  const pts = imgFramePoints(vp, bounds, t)
  if (pts.length === 0) return 'none'
  const rect = imgRect(bounds, t)
  return toClipPath(pts, rect.x, rect.y)
}

/**
 * The rectangle the image's pixels actually occupy, in viewport coordinates —
 * {@link fullImgStyle}'s geometry reduced to a box. At the shipped identity transform
 * this is the artwork's own border: the whole source contain-fitted into its frame.
 */
export function renderedImgRect(
  frame: { x: number; y: number; w: number; h: number },
  nat: { w: number; h: number },
  t: ImgTransform,
): { x: number; y: number; w: number; h: number } {
  const { fit, centerX, centerY } = containGeometry(frame, nat, t)
  const w = nat.w * fit * t.scale
  const h = nat.h * fit * t.scale
  return { x: frame.x + centerX - w / 2, y: frame.y + centerY - h / 2, w, h }
}

/**
 * The rectangle a picture visibly occupies, in viewport coordinates — the editor's
 * notion of "the image", as opposed to the frame it hangs in ({@link imgRect}).
 *
 * At the shipped identity transform this is the artwork's own border: the whole
 * source contain-fitted into its frame ({@link renderedImgRect}), so a hover or
 * selection outline traces the image's true proportions rather than the panel's.
 * It is clamped to the frame box, never outlining pixels the clip discarded. The
 * frame itself is the fallback whenever there is nothing tighter to trace: the
 * natural size is not known yet, a zoom crops past every edge, or a pan pushes the
 * picture fully outside its frame.
 */
export function imgVisibleRect(
  bounds: { x: number; y: number; w: number; h: number },
  nat: { w: number; h: number } | undefined,
  t: ImgTransform,
): { x: number; y: number; w: number; h: number } {
  const frame = imgRect(bounds, t)
  if (!nat || frame.w <= 0 || frame.h <= 0) return frame
  const r = renderedImgRect(frame, nat, t)
  const x1 = Math.max(r.x, frame.x)
  const y1 = Math.max(r.y, frame.y)
  const x2 = Math.min(r.x + r.w, frame.x + frame.w)
  const y2 = Math.min(r.y + r.h, frame.y + frame.h)
  if (x2 <= x1 || y2 <= y1) return frame
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
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
