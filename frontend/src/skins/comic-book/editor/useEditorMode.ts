import { useCallback, useMemo, useState } from 'react'

import { logger } from '../../../lib/logger'
import { CONFIG_KEY, hydrateConfig, seedConfig } from './configOps'
import { setPanelLabel as setPanelLabelIn, splitPanel as splitPanelIn } from './configPanels'
import { setPageLabel as setPageLabelIn } from './configPages'
import { isStaleWorkingCopy, seedStamp } from './configStamp'
import { clearStoredConfig, detectActive, persistConfig, storedStamp } from './editorStorage'
import { resetGridKeepingContent, setGridKeepingContent } from './gridContentRemap'
import type { CutAxis } from './panelGridCut'
import type { EditMode, Selection, SelectionKind } from './selection'
import { useContentEdits } from './useContentEdits'
import type { ContentEdits } from './useContentEdits'
import type { EditorConfig, LayoutKind, PanelGrid, PanelPage } from './types'

// The pure operations on a config live in ./configOps.ts and ./panelGridOps.ts, the
// content mutators in ./useContentEdits.ts and the browser edges in ./editorStorage.ts;
// this module is the React state between them — the edit flag, the working copy, the
// selection, and which half of the editor is in front.

export type { EditMode, Selection, SelectionKind } from './selection'

export interface EditorModeApi extends ContentEdits {
  active: boolean
  config: EditorConfig
  /**
   * True when this working copy was hydrated from a different `layoutConfig.ts` than the
   * one the bundle holds — a merge, a checkout or another tab's Save moved the file under
   * it — so writing it out would revert whatever changed there. See ./configStamp.ts.
   */
  stale: boolean
  selected: Selection | null
  mode: EditMode
  setMode(mode: EditMode): void
  select(kind: SelectionKind, index: number): void
  clear(): void
  resetAll(): void
  /**
   * Replace one page's panel grid for one breakpoint. Deliberately whole-grid and
   * deliberately page-and-kind-addressed: every shape edit is a pure function in
   * ./panelGridOps.ts that takes a grid and returns one, and the caller — which is the
   * thing looking at a route and a window of a known shape — says which grid it just
   * reshaped. Pictures and bubbles hold their place on screen: both are re-expressed
   * against the new panel boxes (./gridContentRemap.ts), so a seam drag moves the
   * window content is seen through, never the content.
   */
  setGridFor(page: PanelPage, kind: LayoutKind, grid: PanelGrid): void
  /** Restore one page's grid for one breakpoint to the shipped default, content held still. */
  resetGridFor(page: PanelPage, kind: LayoutKind): void
  /**
   * Cut `panel` in two through its middle — `across` for a panel above and one below,
   * `down` for side by side — in every grid of its page, appending the new half to the
   * panel list and selecting it. `kind` is the grid on screen, whose content is held
   * still. Returns false, changing nothing, when the cut is refused (./configPanels.ts).
   */
  splitPanel(panel: number, axis: CutAxis, kind: LayoutKind): boolean
  /** Rename one panel. */
  setPanelLabel(panel: number, label: string): void
  /** Override one route's display name for this skin. */
  setPageLabel(path: string, label: string): void
}

/**
 * True when picture `index` should render unclipped (a "full reveal") for framing: the
 * editor is active and that picture is the current selection. PanelImages uses this to
 * drop the frame clip on the selected picture so the whole of it stays visible while
 * you drag/zoom it — the outline SVG still marks where the crop lands.
 */
export function shouldRevealImg(
  active: boolean,
  selected: EditorModeApi['selected'],
  index: number,
): boolean {
  return active && selected?.kind === 'img' && selected.index === index
}

/**
 * The viewport a grid edit is being looked at through. Layout.tsx computes panel boxes
 * from `window.innerWidth/innerHeight`, and the remap that holds content still while a
 * seam is dragged must measure with those same numbers — % of a panel box only names
 * pixels once the box does. Zero (no window) makes the remap a no-op.
 */
function viewportSize(): { w: number; h: number } {
  return typeof window === 'undefined'
    ? { w: 0, h: 0 }
    : { w: window.innerWidth, h: window.innerHeight }
}

/**
 * Dev-only editor state for the comic-book skin. Holds a working copy of the panel
 * transforms and grids (seeded from constants, persisted to localStorage), a current
 * selection, and mutators. Inert (active: false) outside `import.meta.env.DEV` / the
 * edit flag.
 */
export function useEditorMode(): EditorModeApi {
  const [active] = useState(detectActive)
  // The payload is read once and answers two questions: what the working copy is, and
  // which `layoutConfig.ts` it came from. Both from the same string, so a storage write
  // between the two reads cannot pair a config with another payload's stamp.
  const [boot] = useState(() => {
    if (!active || typeof window === 'undefined') return { config: seedConfig(), stamp: null }
    const raw = window.localStorage.getItem(CONFIG_KEY)
    return { config: hydrateConfig(raw), stamp: storedStamp(raw) }
  })
  const [config, setConfig] = useState<EditorConfig>(boot.config)
  // Never recomputed: the seed is a module constant, and a change to the file it comes
  // from restarts the bundle (Vite has no accept handler for it, so it full-reloads).
  const current = useMemo(() => seedStamp(), [])
  const [stamp, setStamp] = useState<string | null>(boot.stamp)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [mode, setModeState] = useState<EditMode>('content')

  const select = useCallback((kind: SelectionKind, index: number) => {
    setSelected({ kind, index })
  }, [])

  // Switching modes drops the selection: a picture index and a vertex index are both
  // numbers, and leaving one behind would have the shape inspector open on "vertex 3"
  // because that is which balloon was selected.
  const setMode = useCallback((next: EditMode) => {
    setModeState(prev => {
      if (prev !== next) setSelected(null)
      return next
    })
  }, [])

  const clear = useCallback(() => setSelected(null), [])

  /** Apply a pure config operation, persisting whatever comes back. */
  const apply = useCallback((op: (prev: EditorConfig) => EditorConfig) => {
    // A payload written before stamps existed adopts this bundle's on its first edit —
    // the one point at which "which file did this come from" has an answer that is at
    // least not a guess. An edit never *refreshes* a stamp that is already there: that is
    // exactly the staleness the stamp exists to keep hold of.
    setStamp(prev => prev ?? current)
    setConfig(prev => {
      const next = op(prev)
      persistConfig(next, stamp ?? current)
      return next
    })
  }, [stamp, current])

  const content = useContentEdits(apply, setSelected)

  const setGridFor = useCallback(
    (page: PanelPage, kind: LayoutKind, grid: PanelGrid) =>
      apply(prev => setGridKeepingContent(prev, page, kind, grid, viewportSize())),
    [apply],
  )

  const resetGridFor = useCallback(
    (page: PanelPage, kind: LayoutKind) => {
      apply(prev => resetGridKeepingContent(prev, page, kind, viewportSize()))
      // The default grid has fewer vertices than a bent one, so a surviving vertex
      // selection would point past the end of the table or at somebody else's corner.
      setSelected(null)
    },
    [apply],
  )

  // Computed against the rendered config rather than inside `apply`'s updater, because
  // the caller needs the answer now — a refused cut is reported in the inspector, and a
  // functional update cannot hand a boolean back out. Nothing else edits the config
  // between a click and its handler, so the two are the same object.
  const splitPanel = useCallback(
    (panel: number, axis: CutAxis, kind: LayoutKind): boolean => {
      const result = splitPanelIn(config, panel, axis, { kind, viewport: viewportSize() })
      if (!result) {
        logger.warn('Refused to split comic-book panel', { panel, axis })
        return false
      }
      apply(() => result.config)
      setSelected({ kind: 'panel', index: result.index })
      return true
    },
    [apply, config],
  )

  const setPanelLabel = useCallback(
    (panel: number, label: string) => apply(prev => setPanelLabelIn(prev, panel, label)),
    [apply],
  )

  const setPageLabel = useCallback(
    (path: string, label: string) => apply(prev => setPageLabelIn(prev, path, label)),
    [apply],
  )

  const resetAll = useCallback(() => {
    // Drop the persisted override entirely so the next load re-seeds from the
    // constants (a true "back to source defaults"), then reflect that in state.
    clearStoredConfig()
    setConfig(seedConfig())
    setSelected(null)
    // The working copy *is* the file again, so whatever it used to predate it no longer
    // does — leaving the old stamp here would warn about a config that came from the very
    // bundle it is being compared with.
    setStamp(current)
  }, [current])

  return useMemo(
    () => ({
      ...content,
      active,
      config,
      stale: isStaleWorkingCopy(stamp),
      selected,
      mode,
      setMode,
      select,
      clear,
      resetAll,
      setGridFor,
      resetGridFor,
      splitPanel,
      setPanelLabel,
      setPageLabel,
    }),
    [
      content, active, config, stamp, selected, mode, setMode, select, clear, resetAll,
      setGridFor, resetGridFor, splitPanel, setPanelLabel, setPageLabel,
    ],
  )
}
