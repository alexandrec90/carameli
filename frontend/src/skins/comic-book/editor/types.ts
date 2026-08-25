import type { TailDir } from '../bubbleBox'
import type { BubbleContentKind } from '../bubbleContent'
import type { PageGrids } from '../panelGeometry'
import type { PanelBgStyle } from '../panelPatterns'
import type { BubbleType } from './bubbleTypes'

// The shape half of the document is declared next door, in ../panelGeometry.ts, because
// the renderer needs it too and this module is the editor's. Re-exported here so
// layoutConfig.ts — which the editor overwrites whole — keeps naming exactly one module
// for its types.
export type { LayoutKind, PageGrids, PanelGrid } from '../panelGeometry'
export type { PanelPage } from '../panels'

/** One column of a projected table. */
export interface TableColumn {
  /** Heading text, drawn in the first row slot when `header` is on. */
  label: string
  /**
   * Share of the surface's width, as a weight against the other columns — not a
   * percentage. Adding a fourth column to three that already summed to 100 would
   * otherwise mean retyping all three.
   */
  width: number
  /** Cell text alignment within the column. */
  align: 'left' | 'center' | 'right'
}

/**
 * Shared placement and lettering for content projected onto a picture.
 *
 * **`quad` is the whole of the 3D tilt.** Four corners, clockwise from top-left, in % of
 * the picture's frame box, and `tableProjection.ts` turns them into the `matrix3d` that
 * lands the table on them. Corners rather than rotate/perspective angles because the
 * task is *matching a plane already in the photograph*: three angles describe the same
 * plane, but only as a three-way search where every axis undoes the last, whereas a
 * projective map through four point correspondences is unique and is dragged into place
 * one corner at a time. The convergence of the far edge comes out of the same four
 * numbers, so ruled lines that converge in the picture are matched rather than
 * approximated.
 */
export interface ProjectedSurface {
  /** The surface's corners, clockwise from top-left, in % of the picture's frame box. */
  quad: [[number, number], [number, number], [number, number], [number, number]]
  /** Lettering height as a fraction of one row's height. */
  fontScale: number
  /** Ink colour for the projected content and its editor-only guides. */
  ink: string
}

/**
 * An HTML table projected onto the surface a picture depicts — ruled lines on a notepad,
 * a whiteboard, the face of a monitor. Optional on every picture, so any of them can be
 * turned into a surface and none of them is one by default.
 *
 * **`rows` is a count of slots, not of data.** The surface is divided into that many
 * equal bands, which is what a ruled page is; the data scrolls through them a whole row
 * at a time, so every band stays exactly where it was drawn. `header` spends the first
 * band on the column labels rather than floating them above the surface, where they
 * would be the one thing not sitting on a line.
 */
export interface TableProjection extends ProjectedSurface {
  /** Row bands the surface is divided into — match this to the lines in the picture. */
  rows: number
  /** Spend the first band on the column headings. */
  header: boolean
  /** The columns, left to right. */
  columns: TableColumn[]
  /** Cell text, row-major, one inner array per row. Longer than `rows` = scrollable. */
  data: string[][]
}

/** A fixed three-column, four-row telephone number pad projected onto a picture. */
export type NumberPadProjection = ProjectedSurface

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
  /**
   * A table projected onto whatever surface this picture depicts; **absent** on an
   * ordinary picture. Optional rather than always-present so `layoutConfig.ts` carries
   * the field only on the pictures that are surfaces — the serializer omits it
   * otherwise, and eight lines of `table: null` would say nothing.
   *
   * Absent rather than `null` for the same reason, and it is load-bearing: the round-trip
   * guarantee is that re-evaluating a saved file gives back the config it was written
   * from, and a picture that went out with no `table` key comes back with no `table` key.
   * A `null` in the working copy would not match it.
   */
  table?: TableProjection
  /**
   * A telephone number pad projected onto this picture; absent unless selected in the
   * editor. Mutually exclusive with `table`, so one image has one set of surface
   * corners and one projected content layer.
   */
  numberPad?: NumberPadProjection
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
  /**
   * How `text` is presented: lettering, a wheel picker, a text input, or a
   * region-aware phone input (see bubbleContent.ts).
   */
  content: BubbleContentKind
  /** Caption/options, or the initial value of an editable input. */
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
 * `grids` is the exception and is *keyed* rather than listed — per page, then one panel
 * subdivision per viewport shape, because the three reshape the page differently and a
 * picture framed for the landscape one has nothing to say about the portrait one. The
 * editor edits whichever grid the route and window it is open in draw.
 *
 * `patterns` is the other exception, and it *is* parallel to PANELS: a Ben-Day
 * background belongs to the panel slot itself, not to a picture or a bubble on it, so
 * entry `i` is the style drawn behind `PANELS[i]`.
 */
export interface EditorConfig {
  images: ImgTransform[]
  bubbles: BubbleTransform[]
  grids: PageGrids
  patterns: PanelBgStyle[]
}
