import type { CSSProperties } from 'react'

import type { ImgTransform, BubbleTransform, EditorConfig } from './types'

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

/** Apply a pointer drag (px delta in viewport space) to an image transform. */
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
 * to {@link imgTransformStyle}'s `object-fit: cover` box. This is the panel image's
 * real geometry once its natural size is known: the panel polygon clip supplies the
 * comic-panel crop, so panning slides the picture under the panel window (re-framing
 * it) instead of moving a pre-cropped box — no source pixels are ever discarded. In
 * edit mode the selected image simply drops the clip, revealing the same geometry.
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
 * Style for the .cb-img-clip wrapper around a panel image. The panel polygon
 * clip-path is what crops the full-source image ({@link fullImgStyle}) into the
 * comic panel. `spill: true` drops the clip so the image pops out of its frame —
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

// ─── Export (Phase 4) ──────────────────────────────────────────────────────────

/** Round to `decimals` places, dropping float noise (e.g. 1.0000000002 → 1). */
function round(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/**
 * Serialize a working {@link EditorConfig} into paste-ready TS matching
 * `layoutConfig.ts` (the two `export const` blocks only). Numbers are rounded for
 * clean output: image `scale` to 2 decimals, pixel offsets and bubble percentages to
 * integers, `rotate` to 1 decimal. Bubble `text` is JSON-escaped so quotes/newlines/
 * backslashes stay valid TS.
 */
export function serializeConfig(c: EditorConfig): string {
  const imgLines = c.images
    .map(
      t =>
        `  { scale: ${round(t.scale, 2)}, offsetX: ${Math.round(t.offsetX)}, ` +
        `offsetY: ${Math.round(t.offsetY)}, anchor: '${t.anchor}', spill: ${t.spill} },`,
    )
    .join('\n')
  const bubbleLines = c.bubbles
    .map(
      b =>
        `  { top: ${Math.round(b.top)}, right: ${Math.round(b.right)}, ` +
        `width: ${Math.round(b.width)}, rotate: ${round(b.rotate, 1)}, ` +
        `spill: ${b.spill}, type: '${b.type}', text: ${JSON.stringify(b.text)} },`,
    )
    .join('\n')
  return (
    `export const PANEL_IMG_TRANSFORMS: ImgTransform[] = [\n${imgLines}\n]\n\n` +
    `export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [\n${bubbleLines}\n]\n`
  )
}

/**
 * Serialize a full, ready-to-write `editor/layoutConfig.ts` file: the type import
 * header plus the two `export const` blocks from {@link serializeConfig}. Used by the
 * editor's Save button, which POSTs this verbatim to the dev-only write endpoint.
 */
export function serializeConfigFile(c: EditorConfig): string {
  return `import type { ImgTransform, BubbleTransform } from './types'\n\n${serializeConfig(c)}`
}
