import { splitAt } from '../callSceneGeometry'
import { callSceneOn, halfFor } from '../callSceneRoles'
import type { PanelPoly } from '../panelGeometry'
import type { EditorModeApi } from './useEditorMode'

/**
 * Box the current selection is measured against: the box of the panel the selected entry
 * *names*, never `panelPolys[selection.index]` — neither array lines up with the panels
 * any more, since a panel may own several pictures and several bubbles. Getting this
 * wrong scales a drag by another panel's dimensions, so it is resolved in one place for
 * every input path — the pointer handlers and the keyboard shortcuts alike.
 *
 * And half a panel's box when the entry is part of the call showing on it, for the same
 * reason and with the same consequence: an entry framed against a half whose drag is
 * scaled by the whole panel travels about twice as far as the pointer.
 */
export function selectionBounds(
  api: EditorModeApi,
  panelPolys: (PanelPoly | null)[],
): PanelPoly['bounds'] | null {
  const sel = api.selected
  if (!sel) return null
  const entry =
    sel.kind === 'img'
      ? api.config.images[sel.index]
      : sel.kind === 'bubble'
        ? api.config.bubbles[sel.index]
        : undefined
  const panel = sel.kind === 'panel' ? sel.index : entry?.panel
  if (panel === undefined) return null
  const poly = panelPolys[panel]
  if (!poly) return null
  const scene = api.callPhase === null ? undefined : callSceneOn(api.config.callScenes, panel)
  const halves = scene ? splitAt(poly.vp, poly.bounds, scene.cut, scene.axis) : null
  return (entry && halfFor(entry.call, halves)?.box) ?? poly.bounds
}
