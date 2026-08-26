import { useMemo } from 'react'

import { useLiveTables, type LiveTableRows } from '../../hooks/useLiveTables'
import type { TableSource } from '../../lib/liveTables'
import type { ImgTransform } from './editor/types'

/**
 * The page's pictures with every live surface's cells filled in.
 *
 * The seam is deliberately here and nowhere lower. `ProjectedTable` stays a component that
 * draws the `data` it is handed, `PanelImages` stays a component that draws the pictures
 * it is handed, and neither learns that a table can be live — which is what keeps them
 * testable without a fetch and keeps the skin free of API knowledge. Everything about
 * *where the records come from* is one hook call, in `hooks/`, above all of it.
 *
 * The injected rows never reach the editor's working copy: `Layout` runs its config
 * through here on the way to the panels, so what the editor holds — and therefore what
 * Save writes into `layoutConfig.ts` — is still the authored surface with no cells.
 */

/** Every feed named by a picture on the page, in first-seen order, deduped. */
export function liveTableSources(images: ImgTransform[]): TableSource[] {
  const out: TableSource[] = []
  for (const img of images) {
    const source = img.table?.source
    if (source && !out.includes(source)) out.push(source)
  }
  return out
}

/**
 * `images`, with each live surface's `data` replaced by the cells its feed is showing.
 *
 * Identity is preserved wherever nothing changed — the whole array when no picture is
 * live, and each individual picture whose feed has not moved — because this result is the
 * prop every panel renders from, and a new array on each poll would repaint the page's
 * canvases every few seconds to redraw the same eight lines.
 */
export function withLiveRows(images: ImgTransform[], rows: LiveTableRows): ImgTransform[] {
  if (!images.some(img => img.table?.source)) return images
  return images.map(img => {
    const source = img.table?.source
    if (!source || !img.table) return img
    const data = rows[source] ?? []
    if (img.table.data === data) return img
    return { ...img, table: { ...img.table, data } }
  })
}

/** {@link withLiveRows} over whichever feeds the given pictures actually ask for. */
export function useLiveTableImages(images: ImgTransform[]): ImgTransform[] {
  const sources = useMemo(() => liveTableSources(images), [images])
  const rows = useLiveTables(sources)
  return useMemo(() => withLiveRows(images, rows), [images, rows])
}
