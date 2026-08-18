import type { TailDir } from '../bubbleBox'
import type { BubbleType } from './bubbleTypes'

/**
 * Per-panel image framing, relative to the panel box. Layout-independent, and index
 * parallel to the panels: a panel shows exactly one picture, which is why this one
 * kept the parallel array that {@link BubbleTransform} gave up.
 */
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

/**
 * One speech bubble: which panel it belongs to, where it sits on that panel, and what
 * it says.
 *
 * A panel may own any number of bubbles, or none. `panel` is the whole association —
 * placement is measured against that panel's box and the bubble is revealed when that
 * panel is hovered — so moving a bubble to another panel is a single field change.
 */
export interface BubbleTransform {
  /** Index into PANELS of the panel this bubble belongs to. */
  panel: number
  /** top offset in %, may be negative (bubble floats above the panel). */
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
  /** Which way the tail points, or 'none' (see TAIL_DIRS in bubbleBox.ts). */
  tail: TailDir
  /** Bubble caption text. */
  text: string
  /**
   * Bubble to join with a connector tube, by index into the bubble array; null when
   * unlinked. The link is symmetric — declaring it on either end draws one tube.
   *
   * **Both ends must sit on the same panel.** A tube is one speaker's utterance
   * continuing across two balloons, and the two halves of it appearing on different
   * hovers is not a thing that can read as one utterance; the editor only offers
   * same-panel partners and the renderer drops any cross-panel link it is handed.
   */
  linkTo: number | null
  /** Shape to morph to while the pointer is over the bubble; null = stay put. */
  hoverType: BubbleType | null
  /** Shape to pulse to when the bubble is pressed; null = stay put. */
  clickType: BubbleType | null
}

/**
 * The editor's working document. `images` is index-parallel to the panels; `bubbles`
 * is not — each bubble names its own panel, so the array is free-length and adding one
 * is an append that has to line up with nothing.
 */
export interface EditorConfig {
  images: ImgTransform[]
  bubbles: BubbleTransform[]
}
