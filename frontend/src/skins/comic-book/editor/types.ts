import type { TailDir } from '../bubbleBox'
import type { PanelGrids } from '../panelGeometry'
import type { BubbleType } from './bubbleTypes'

// The shape half of the document is declared next door, in ../panelGeometry.ts, because
// the renderer needs it too and this module is the editor's. Re-exported here so
// layoutConfig.ts — which the editor overwrites whole — keeps naming exactly one module
// for its types.
export type { LayoutKind, PanelGrid, PanelGrids } from '../panelGeometry'

/**
 * One picture on the page: which panel it belongs to, which file it shows, the frame
 * it is cropped to, and how the picture is framed *inside* that crop.
 *
 * A panel may own any number of pictures, or none. The frame — `left`/`top`/`width`/
 * `height`, in % of the panel box — is the picture's own, exactly as a bubble's
 * placement is. It used to be the panel polygon itself, which meant dragging an image
 * only slid the picture under a window that stayed put, and a second picture on the
 * same panel had nowhere to be. The frame takes the panel's shape scaled into it (see
 * `imgFramePoly`), so a picture left at the default 0/0/100/100 crops exactly as the
 * panel always did, and an inset one reads as a small comic panel rather than as a
 * rectangle pasted on top.
 *
 * `scale`/`offsetX`/`offsetY`/`anchor` are the second, independent framing: they move
 * the picture *within* its frame, which is what dragging used to do to the whole image.
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
  /** Frame width, in % of the panel box. */
  width: number
  /** Frame height, in % of the panel box. */
  height: number
  /** Zoom factor for the picture inside the frame (CSS transform: scale). */
  scale: number
  /** Horizontal pan of the picture inside the frame, in px. */
  offsetX: number
  /** Vertical pan of the picture inside the frame, in px. */
  offsetY: number
  /** CSS object-position anchor the framing starts from, e.g. 'center bottom'. */
  anchor: string
  /** When true the picture may bleed past its frame; when false it is clipped to it. */
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
 *
 * `grids` is the exception and is *keyed* rather than listed — one panel subdivision per
 * viewport shape, because the three reshape the page differently and a picture framed
 * for the landscape one has nothing to say about the portrait one. The editor edits
 * whichever grid the window it is open in draws.
 */
export interface EditorConfig {
  images: ImgTransform[]
  bubbles: BubbleTransform[]
  grids: PanelGrids
}
