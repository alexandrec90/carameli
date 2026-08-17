import type { BubbleType } from './bubbleTypes'

/** Per-panel image framing, relative to the panel box. Layout-independent. */
export interface ImgTransform {
  /** Zoom factor applied via CSS transform: scale(). 1 = fill (objectFit cover); < 1 shrinks. */
  scale: number
  /** Horizontal pan in px (CSS transform: translateX). */
  offsetX: number
  /** Vertical pan in px (CSS transform: translateY). */
  offsetY: number
  /** CSS object-position base anchor, e.g. 'center bottom'. */
  anchor: string
  /** When true, the image may bleed past the panel edge; when false it's clipped to the panel polygon. */
  spill: boolean
}

/** Per-panel speech-bubble placement + content, in % of the panel box. */
export interface BubbleTransform {
  /** top offset in %, may be negative (bubble floats above panel). */
  top: number
  /** right offset in %, may be negative. */
  right: number
  /** bubble width in % of panel width. */
  width: number
  /** rotation in degrees. */
  rotate: number
  /** When true (default), the bubble floats into the gutter; when false it's clipped to the panel polygon. */
  spill: boolean
  /** Resting shape + lettering font (see BUBBLE_TYPES and bubbleShape.ts). */
  type: BubbleType
  /** Bubble caption text. */
  text: string
  /**
   * Bubble to join with a connector tube, by panel index; null when unlinked. The
   * link is symmetric — declaring it on either end draws one tube and reveals both
   * bubbles together.
   */
  linkTo: number | null
  /** Shape to morph to while the pointer is over the bubble; null = stay put. */
  hoverType: BubbleType | null
  /** Shape to pulse to when the bubble is pressed; null = stay put. */
  clickType: BubbleType | null
}

export interface EditorConfig {
  images: ImgTransform[]   // length 8, parallel to PANEL_IMAGES
  bubbles: BubbleTransform[] // length 8, parallel to PANEL_IMAGES
}
