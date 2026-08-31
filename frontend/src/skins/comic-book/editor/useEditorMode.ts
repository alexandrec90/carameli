import { useCallback, useMemo, useState } from 'react'

import { setPanelLabel as setPanelLabelIn } from './configPanels'
import { setPageLabel as setPageLabelIn } from './configPages'
import { detectActive } from './editorStorage'
import type { EditMode, Selection, SelectionKind } from './selection'
import { useCallEdits } from './useCallEdits'
import type { CallEdits } from './useCallEdits'
import { useContentEdits } from './useContentEdits'
import type { ContentEdits } from './useContentEdits'
import { useGridEdits } from './useGridEdits'
import type { GridEdits } from './useGridEdits'
import { useWorkingCopy } from './useWorkingCopy'
import type { EditorConfig } from './types'

// The pure operations on a config live in ./configOps.ts and ./panelGridOps.ts, the
// mutators in ./useContentEdits.ts, ./useCallEdits.ts and ./useGridEdits.ts, the browser
// edges in ./editorStorage.ts and the working copy's own state in ./useWorkingCopy.ts;
// this module is the React state between them — the edit flag, the selection, and which
// half of the editor is in front.

export type { EditMode, Selection, SelectionKind } from './selection'

export interface EditorModeApi extends ContentEdits, CallEdits, GridEdits {
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
 * Dev-only editor state for the comic-book skin. Holds a working copy of the panel
 * transforms and grids (seeded from constants, persisted to localStorage), a current
 * selection, and mutators. Inert (active: false) outside `import.meta.env.DEV` / the
 * edit flag.
 */
export function useEditorMode(): EditorModeApi {
  const [active] = useState(detectActive)
  const copy = useWorkingCopy(active)
  const { config, apply } = copy
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

  const content = useContentEdits(apply, setSelected)
  const call = useCallEdits(apply, setSelected)
  const grid = useGridEdits(apply, setSelected, config)

  const setPanelLabel = useCallback(
    (panel: number, label: string) => apply(prev => setPanelLabelIn(prev, panel, label)),
    [apply],
  )

  const setPageLabel = useCallback(
    (path: string, label: string) => apply(prev => setPageLabelIn(prev, path, label)),
    [apply],
  )

  const resetAll = useCallback(() => {
    copy.reset()
    setSelected(null)
  }, [copy])

  return useMemo(
    () => ({
      ...content,
      ...call,
      ...grid,
      active,
      config,
      stale: copy.stale,
      selected,
      mode,
      setMode,
      select,
      clear,
      resetAll,
      setPanelLabel,
      setPageLabel,
    }),
    [
      content, call, grid, active, config, copy.stale, selected, mode, setMode, select,
      clear, resetAll, setPanelLabel, setPageLabel,
    ],
  )
}
