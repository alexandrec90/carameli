import type { LayoutKind, PanelGrid } from '../panelGeometry'
import { PANEL_PAGES } from '../panels'
import type { PanelPage } from '../panels'
import { removeBubble } from './configOps'
import type { SplitView } from './configPanels'
import { cloneConfig, LAYOUT_KINDS } from './configSeed'
import { remapBubblesToGrid, remapImagesToGrid } from './gridContentRemap'
import type { CutAxis } from './panelGridCut'
import { absorbPanel, cutPanelInto } from './panelGridAbsorb'
import { reconcile } from './reconcile'
import type { EditorConfig } from './types'

// The panel list getting *shorter*, and a panel leaving one of its page's grids without
// leaving the list. configPanels.ts is the list lengthening; this is the other direction,
// and it is the one file that renumbers: a deleted slot is spliced out of everything
// that is indexed by panel — the list, the patterns, all six ring tables, and the
// `panel` field of every picture, balloon and call scene — in one pure function, so no
// caller ever sees a config with the slot half gone.

/** Panels of `page` that hold an empty ring on `kind`'s grid: on the page, not on this shape. */
export function hiddenOn(config: EditorConfig, page: PanelPage, kind: LayoutKind): number[] {
  const grid = config.grids[page][kind]
  return config.panels.flatMap((p, i) => (p.page === page && (grid.panels[i]?.length ?? 0) === 0 ? [i] : []))
}

/** Swap in one grid, holding the content the author is looking at still on screen. */
function replaceGrid(
  config: EditorConfig,
  page: PanelPage,
  kind: LayoutKind,
  grid: PanelGrid,
  view?: SplitView,
): void {
  const from = config.grids[page][kind]
  if (view && view.kind === kind) {
    config.images = remapImagesToGrid(config.images, from, grid, view.frame)
    config.bubbles = remapBubblesToGrid(config.bubbles, from, grid, view.frame)
  }
  config.grids[page][kind] = grid
}

/**
 * Take `panel` off `kind`'s grid of its page — its space goes to the neighbour across its
 * longest boundary — and keep it on the other two shapes. The panel's pictures and
 * balloons stay on it and are simply not drawn at that shape, as nothing is drawn for a
 * panel with no ring; the neighbour's content holds its place on screen (`view`). Null,
 * changing nothing, when the panel is not on that grid or no neighbour can take it.
 */
export function hidePanelOn(
  config: EditorConfig,
  panel: number,
  kind: LayoutKind,
  view?: SplitView,
): EditorConfig | null {
  const page = config.panels[panel]?.page
  if (!page) return null
  const absorbed = absorbPanel(config.grids[page][kind], panel)
  if (!absorbed) return null
  const next = cloneConfig(config)
  replaceGrid(next, page, kind, absorbed.grid, view)
  return next
}

/**
 * Put a panel hidden on `kind`'s grid back on it, as the lower or right half of `from`
 * cut along `axis` — the same cut {@link splitPanel} makes, aimed at the empty slot
 * instead of a new one. Null when the panel is not hidden there, the two are not on the
 * same page, or the cut is refused.
 */
export function showPanelOn(
  config: EditorConfig,
  panel: number,
  kind: LayoutKind,
  from: number,
  axis: CutAxis,
  view?: SplitView,
): EditorConfig | null {
  const page = config.panels[panel]?.page
  if (!page || config.panels[from]?.page !== page) return null
  const grid = cutPanelInto(config.grids[page][kind], from, axis, panel)
  if (!grid) return null
  const next = cloneConfig(config)
  replaceGrid(next, page, kind, grid, view)
  return next
}

/** `index`, with the slot `gone` spliced out from under it. */
function shift(index: number, gone: number): number {
  return index > gone ? index - 1 : index
}

/**
 * Delete `panel` outright: off every grid it is drawn on (each grid's neighbour takes
 * its space, as {@link hidePanelOn} does), out of the list, and its pictures and
 * balloons with it. Every later panel moves down one, and everything that names a panel
 * by index follows — this is the one edit after which an index moves, which is why it
 * is a single function and not a delete followed by a renumber.
 *
 * Refused whole — null, nothing changed — when any grid of its page cannot give the
 * space away: a panel gone from two shapes and stuck on the third would be a hidden
 * panel the author did not ask for.
 */
export function deletePanel(
  config: EditorConfig,
  panel: number,
  view?: SplitView,
): EditorConfig | null {
  const page = config.panels[panel]?.page
  if (!page) return null
  const next = cloneConfig(config)
  for (const kind of LAYOUT_KINDS) {
    const grid = next.grids[page][kind]
    if ((grid.panels[panel]?.length ?? 0) === 0) continue
    const absorbed = absorbPanel(grid, panel)
    if (!absorbed) return null
    replaceGrid(next, page, kind, absorbed.grid, view)
  }

  // The balloons go one at a time, highest index first, so each removal's link
  // renumbering sees the indices the next one will splice.
  let out: EditorConfig = next
  for (let i = out.bubbles.length - 1; i >= 0; i--) {
    if (out.bubbles[i].panel === panel) out = removeBubble(out, i)
  }
  out.images = out.images.filter(img => img.panel !== panel)

  out.panels.splice(panel, 1)
  out.patterns.splice(panel, 1)
  for (const p of PANEL_PAGES) {
    for (const kind of LAYOUT_KINDS) {
      const grid = out.grids[p][kind]
      out.grids[p][kind] = { vertices: grid.vertices, panels: grid.panels.filter((_, i) => i !== panel) }
    }
  }
  out.images = out.images.map(img => ({ ...img, panel: shift(img.panel, panel) }))
  out.bubbles = out.bubbles.map(b => ({ ...b, panel: shift(b.panel, panel) }))
  out.callScenes = out.callScenes
    .filter(s => s.panel !== panel)
    .map(s => ({ ...s, panel: shift(s.panel, panel) }))
  return reconcile(out)
}
