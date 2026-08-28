import type { LayoutKind } from '../panelGeometry'
import { PANEL_PAGES } from '../panels'
import type { Panel } from '../panels'
import { PATTERN_STYLE_KEYS } from '../panelPatterns'
import { cloneConfig, LAYOUT_KINDS } from './configSeed'
import { remapBubblesToGrid, remapImagesToGrid } from './gridContentRemap'
import type { CutAxis } from './panelGridCut'
import { cutPanel } from './panelGridCut'
import type { EditorConfig } from './types'

// The panel *list* as an editable thing. Until this file the list was a constant every
// other array lined up against; now the editor can lengthen it, and this is the one
// place that knows everything that has to lengthen with it — the ring table of all six
// grids, the pattern list, and nothing else, because pictures and bubbles name their
// panel rather than lining up with it.

/** Type guard for a parsed `panels` payload: an array of well-formed {@link Panel}s. */
export function isPanelList(value: unknown): value is Panel[] {
  return (
    Array.isArray(value) &&
    value.every(p => {
      if (typeof p !== 'object' || p === null) return false
      const { label, isLogo, page } = p as Record<string, unknown>
      return (
        typeof label === 'string' &&
        typeof isLogo === 'boolean' &&
        PANEL_PAGES.includes(page as Panel['page'])
      )
    })
  )
}

/**
 * The label a panel split off `base` gets: the base's stem (its label with any trailing
 * number dropped) plus the smallest counter from 2 that no existing label uses. So
 * `Mechanic` begets `Mechanic 2`, and `Mailman 1` — with `Mailman 2` already in the
 * list — begets `Mailman 3`. Never the bare stem: that is the parent's own name.
 */
export function nextPanelLabel(base: string, taken: string[]): string {
  const stem = base.replace(/ \d+$/, '').trim() || 'Panel'
  const used = new Set(taken)
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}`
    if (!used.has(candidate)) return candidate
  }
}

/** Which grid the author is looking at, so its content can be held still. */
export interface SplitView {
  kind: LayoutKind
  viewport: { w: number; h: number }
}

/**
 * Split `panel` in two along a straight cut through the middle of its box — a
 * horizontal line for `across`, a vertical one for `down` — in every grid of its page,
 * appending the new half to the panel list. Returns the new config and the new
 * panel's index, or null when the cut is refused in any grid, in which case nothing
 * changes: a panel that exists at two window shapes and not the third would be a
 * puzzle for the author to find, not a feature.
 *
 * The parent keeps its index, its label, its pattern and the upper (or left) half;
 * the new panel takes the parent's pattern, a numbered copy of its label
 * ({@link nextPanelLabel}) and is never the logo. Pictures and bubbles stay on the
 * parent — they name it — and in the grid the author is looking at they are also held
 * still on screen (`view`), so a picture that spanned the whole panel now hangs over
 * the new seam rather than shrinking into the top half. The other two grids are not
 * on screen and get no such treatment; the author sees them by resizing the window.
 *
 * The other page's grids gain an empty ring, as every panel has on the page it is not
 * on. `cutPanel` does the geometry; this decides what goes with it.
 */
export function splitPanel(
  config: EditorConfig,
  panel: number,
  axis: CutAxis,
  view?: SplitView,
): { config: EditorConfig; index: number } | null {
  const parent = config.panels[panel]
  if (!parent) return null
  const next = cloneConfig(config)
  const index = next.panels.length
  for (const page of PANEL_PAGES) {
    for (const kind of LAYOUT_KINDS) {
      const grid = next.grids[page][kind]
      if (page !== parent.page) {
        grid.panels.push([])
        continue
      }
      const cut = cutPanel(grid, panel, axis)
      if (!cut || cut.index !== index) return null
      if (view && view.kind === kind) {
        const { w, h } = view.viewport
        next.images = remapImagesToGrid(next.images, grid, cut.grid, w, h)
        next.bubbles = remapBubblesToGrid(next.bubbles, grid, cut.grid, w, h)
      }
      next.grids[page][kind] = cut.grid
    }
  }
  next.panels.push({
    label: nextPanelLabel(parent.label, next.panels.map(p => p.label)),
    isLogo: false,
    page: parent.page,
  })
  next.patterns.push(next.patterns[panel] ?? PATTERN_STYLE_KEYS[0])
  return { config: next, index }
}

/** Rename one panel, returning a new config; an index off the list is a no-op copy. */
export function setPanelLabel(config: EditorConfig, panel: number, label: string): EditorConfig {
  const next = cloneConfig(config)
  const target = next.panels[panel]
  if (target) next.panels[panel] = { ...target, label }
  return next
}
