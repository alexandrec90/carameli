import { useCallback, useMemo, useState } from 'react'

import { logger } from '../../../lib/logger'
import type { CallScenePhase } from '../phoneActions'
import { addCallScene, CONFIG_KEY, hydrateConfig, patchCallScene, seedConfig } from './configOps'
import { setPanelLabel as setPanelLabelIn, splitPanel as splitPanelIn } from './configPanels'
import { setPageLabel as setPageLabelIn } from './configPages'
import { clearStoredConfig, detectActive, persistConfig } from './editorStorage'
import { resetGridKeepingContent, setGridKeepingContent } from './gridContentRemap'
import type { CutAxis } from './panelGridCut'
import type { EditMode, Selection, SelectionKind } from './selection'
import { useContentEdits } from './useContentEdits'
import type { ContentEdits } from './useContentEdits'
import type { CallSceneLayout, EditorConfig, LayoutKind, PanelGrid, PanelPage } from './types'

// The pure operations on a config live in ./configOps.ts and ./panelGridOps.ts, the
// content mutators in ./useContentEdits.ts and the browser edges in ./editorStorage.ts;
// this module is the React state between them — the edit flag, the working copy, the
// selection, and which half of the editor is in front.

export type { EditMode, Selection, SelectionKind } from './selection'

export interface EditorModeApi extends ContentEdits {
  active: boolean
  config: EditorConfig
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
  /**
   * Which layout every panel that has a call scene is being shown in: `null` for its
   * ordinary pictures and balloons, a phase for its call.
   *
   * One control rather than a switch plus a phase, because "showing the default layout,
   * connected" is not a state anything could draw. It is session state and not config:
   * which layout an author is looking at is where they are standing, not something about
   * the page, so it is neither persisted nor serialized — a reload comes back on the
   * default layout with the work intact.
   */
  callPhase: CallScenePhase | null
  setCallPhase(phase: CallScenePhase | null): void
  /**
   * Turn `panel` into a phone call: the figures, the words and the red key, each an
   * ordinary picture or balloon from then on (./callSceneCreate.ts). Switches to the call
   * layout as well, because the six entries it just made are invisible on the other one —
   * an add whose result you cannot see reads as an add that did nothing.
   *
   * Lives here rather than in ./useContentEdits.ts, beside `splitPanel`, for the reason
   * that one does: it is a content edit that also needs state the content half is not
   * given.
   */
  addCallOn(panel: number): void
  /** Move one panel's seam, or turn it. A patch for a panel with no call is a no-op. */
  setCallScene(panel: number, patch: Partial<CallSceneLayout>): void
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
  const [config, setConfig] = useState<EditorConfig>(() =>
    active && typeof window !== 'undefined'
      ? hydrateConfig(window.localStorage.getItem(CONFIG_KEY))
      : seedConfig(),
  )
  const [selected, setSelected] = useState<Selection | null>(null)
  const [mode, setModeState] = useState<EditMode>('content')
  // Unlike a mode switch, this one keeps the selection. An entry that has just gone off
  // screen is still the thing the author is editing — they may have switched layouts to
  // see what it hides — and the handle that could be dragged blind is EditorOverlay's to
  // withhold, which it must do anyway to hit-test what is actually drawn.
  const [callPhase, setCallPhase] = useState<CallScenePhase | null>(null)

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
    setConfig(prev => {
      const next = op(prev)
      persistConfig(next)
      return next
    })
  }, [])

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

  const addCallOn = useCallback(
    (panel: number) => {
      let added = -1
      apply(prev => {
        const { config: next, index } = addCallScene(prev, panel)
        added = index
        return next
      })
      // Ringing: the first thing an author frames is where the two halves fall, and the
      // ringing figure is the one that stands alone in its own half.
      setCallPhase('ringing')
      // The first figure, not the last entry — a call is added to look at it, and the
      // picture is what the author drags first. A refused add hands back the picture that
      // was already there, which is the same answer.
      if (added >= 0) setSelected({ kind: 'img', index: added })
    },
    [apply],
  )

  const setCallScene = useCallback(
    (panel: number, patch: Partial<CallSceneLayout>) =>
      apply(prev => patchCallScene(prev, panel, patch)),
    [apply],
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
  }, [])

  return useMemo(
    () => ({
      ...content,
      active,
      config,
      selected,
      mode,
      setMode,
      select,
      clear,
      resetAll,
      setGridFor,
      resetGridFor,
      splitPanel,
      callPhase,
      setCallPhase,
      addCallOn,
      setCallScene,
      setPanelLabel,
      setPageLabel,
    }),
    [
      content, active, config, selected, mode, setMode, select, clear, resetAll,
      setGridFor, resetGridFor, splitPanel, callPhase, setCallPhase, addCallOn,
      setCallScene, setPanelLabel, setPageLabel,
    ],
  )
}
