import type { TailDir } from '../bubbleBox'
import type { BubbleChain } from '../bubbleChain'
import type { BubbleContentKind } from '../bubbleContent'
import type { PageGrids } from '../panelGeometry'
import type { PanelBgStyle } from '../panelPatterns'
import type { NumberPadProjection, TableProjection } from '../surfaceTypes'
import type { BubbleType } from './bubbleTypes'

// The shape half of the document is declared next door, in ../panelGeometry.ts, because
// the renderer needs it too and this module is the editor's. Re-exported here so
// layoutConfig.ts — which the editor overwrites whole — keeps naming exactly one module
// for its types.
export type { LayoutKind, PageGrids, PanelGrid } from '../panelGeometry'
export type { PanelPage } from '../panels'

// Same bargain for chains: the renderer owns the behaviour (../bubbleChain.ts), the
// editor owns the field on the bubble that joins one, and layoutConfig.ts imports both
// names from here.
export type { BubbleChain } from '../bubbleChain'

// And again for what a picture can have projected onto it: the renderer owns those types
// (`../surfaceTypes.ts`), the editor owns the fields on the picture that carry them, and
// layoutConfig.ts imports every name it needs from here.
export type {
  NumberPadProjection,
  ProjectedSurface,
  TableColumn,
  TableProjection,
} from '../surfaceTypes'

/**
 * One picture on the page: which panel it belongs to, which file it shows, the frame
 * it is cropped to, and how the picture is framed *inside* that crop.
 *
 * A panel may own any number of pictures, or none. The frame — `left`/`top`/`width`/
 * `height`, in % of the panel box — is the picture's own, exactly as a bubble's
 * placement is. It used to be the panel polygon itself, which meant dragging an image
 * only slid the picture under a window that stayed put, and a second picture on the
 * same panel had nowhere to be. The frame is a plain rectangle and stays one: the panel
 * is the window the picture is seen through (`imgPanelClip`), so a picture left at the
 * default 0/0/100/100 crops exactly as the panel always did, while an inset one is a
 * rectangle of picture and not a small panel — no shape of its own, and no ink of its
 * own either.
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
  /**
   * Id of the bubble chain this balloon is a slot of; '' when it is not in one.
   *
   * **Not typed by the author.** The editor generates it and never shows it: the author
   * says "these balloons are one thread" by linking them and ticking one checkbox, and
   * `propagateChains` then gives every balloon in that linked group the same id. The id
   * exists so the chain's *settings* have a stable place to live while bubbles are added,
   * deleted and renumbered around them — see {@link EditorConfig.chains}.
   *
   * Bubbles sharing an id on the same panel form one vertical column, ordered by `top`,
   * so the lowest is the root: it carries the tail and holds the newest message, and each
   * balloon above it is older. The column's behaviour (does it grow in, how fast, what
   * transcript) is one entry in the chain list, not a per-bubble flag, because it is a
   * property of the thread rather than of any one balloon. See ../bubbleChain.ts.
   *
   * A chained bubble takes no connector tube — this field is what tells `linkedPairs`
   * which of the two meanings a `linkTo` has. A tube joins two balloons that are on
   * screen together and stay put; a chain slot holds a *different message* from one
   * moment to the next, so a tube welded to it would be joining whatever happened to
   * scroll into place.
   */
  chain: string
}

/**
 * The editor's working document. Neither array is parallel to PANELS: each entry names
 * its own panel, so both are free-length and adding one is an append that has to line
 * up with nothing.
 *
 * `chains` is derived rather than authored: its entries are exactly the ids the bubbles
 * carry, kept in step by `syncChains` after every edit — and those ids are themselves
 * derived, from the linkage, by `propagateChains`. Ticking the chain box on a linked group
 * creates the entry; unticking it removes it. That is what stops a config accumulating
 * settings for threads that no longer exist, and what makes "add a chain" and "delete a
 * chain" operations that never had to be written.
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
  chains: BubbleChain[]
  grids: PageGrids
  patterns: PanelBgStyle[]
}
