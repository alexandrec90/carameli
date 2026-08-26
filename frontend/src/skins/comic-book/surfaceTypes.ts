import type { TableSource } from '../../lib/liveTables'

// What can be projected onto the plane a picture depicts. Declared here rather than in
// editor/types.ts — and re-exported from there — for the same reason the panel-shape types
// are: the *renderer* needs them (ProjectedTable.tsx, tableData.ts, tableProjection.ts),
// and the editor is a dev-only overlay the production bundle drops. layoutConfig.ts still
// names exactly one module for its types.

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
  /**
   * Cell text, row-major, one inner array per row. Longer than `rows` = scrollable.
   *
   * **Empty, and left empty, when `source` is set.** A live surface's cells belong to the
   * database, not to the page's composition: authored rows saved beside a feed would be
   * dead text nobody can see, and — since the feed is call and message history — real
   * phone numbers written into `layoutConfig.ts` on the first save.
   */
  data: string[][]
  /**
   * The live feed this surface draws instead of `data`, or **absent** when the author
   * typed the cells.
   *
   * Absent rather than `'none'` for the same reason `table` itself is absent on a picture
   * that is not a surface: `'source' in table` is then a question with an answer, and a
   * config that went out with no feed comes back with no feed. The records arrive through
   * `hooks/useLiveTables.ts` — the skin names a feed and is handed cells; it does not
   * fetch, and knows nothing about customers, endpoints or polling.
   */
  source?: TableSource
}

/** A fixed three-column, four-row telephone number pad projected onto a picture. */
export type NumberPadProjection = ProjectedSurface
