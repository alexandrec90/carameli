import type { TailDir } from '../bubbleBox'
import type { BubbleType } from './bubbleTypes'

/**
 * One picture on the page: which panel it belongs to, which file it shows, and where
 * on that panel it sits.
 *
 * A panel may own any number of pictures, or none. The frame — `left`/`top`/`width`,
 * in % of the panel box — is the picture's own placement, exactly as a bubble's
 * `top`/`right`/`width` is. It used to be the panel polygon itself, which meant
 * dragging an image only slid the picture under a window that stayed put, and a second
 * picture on the same panel had nowhere to be.
 *
 * There is no `height`, and that absence is the design. The height follows the
 * source's aspect ratio, the way a bubble's follows BUBBLE_ASPECT, so the frame is the
 * picture's outline and never a window cut through it. An authored height was a second
 * shape the picture had to be forced into, and forcing it is what cropped: with one
 * height per panel the eight shipped pictures each lost a different amount of their
 * source, and the box the editor drew was the surviving crop rather than the picture.
 *
 * Nothing frames the picture *inside* the frame any more either — no `scale`, no
 * `offsetX`/`offsetY`, no `anchor`. Those chose which part of a picture survived, and
 * nothing is discarded now: moving the frame moves the picture and resizing it resizes
 * the picture.
 *
 * The frame is geometry alone. It is not a shape and not a border: it draws no ink,
 * and the crop comes from the *panel* (see `imgPanelClip`) or, with `spill` on, from
 * nothing. A frame that also cropped meant a picture whose frame was wider than its
 * panel escaped the panel with `spill` unchecked.
 */
export interface ImgTransform {
  /** Index into PANELS of the panel this picture belongs to. */
  panel: number
  /** Public URL of the picture (see PANEL_ASSETS in assets.ts). */
  src: string
  /** Alt text; '' marks the picture decorative. */
  alt: string
  /** Frame left edge, in % of the panel box. May be negative. */
  left: number
  /** Frame top edge, in % of the panel box. May be negative. */
  top: number
  /** Frame width, in % of the panel box. The height follows the source's ratio. */
  width: number
  /** When true the picture may bleed past the panel edge; when false it is clipped to it. */
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
 * The editor's working document. Neither array is parallel to PANELS: each entry names
 * its own panel, so both are free-length and adding one is an append that has to line
 * up with nothing.
 */
export interface EditorConfig {
  images: ImgTransform[]
  bubbles: BubbleTransform[]
}
