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

/** Resize a bubble by a px handle delta → width %, clamped to BUBBLE_W. */
export function resizeBubble(b: BubbleTransform, dWidthPx: number, panelW: number): BubbleTransform {
  return { ...b, width: clamp(b.width + (dWidthPx / panelW) * 100, BUBBLE_W.min, BUBBLE_W.max) }
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
