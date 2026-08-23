import { useCallback, useMemo, useState } from 'react'

import { CONFIG_KEY, hydrateConfig, resetGrid, seedConfig, setGrid } from './configOps'
import { clearStoredConfig, detectActive, persistConfig } from './editorStorage'
import type { EditMode, Selection, SelectionKind } from './selection'
import { useContentEdits } from './useContentEdits'
import type { ContentEdits } from './useContentEdits'
import type { EditorConfig, LayoutKind, PanelGrid } from './types'

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
   * Replace one breakpoint's panel grid. Deliberately whole-grid and deliberately
   * kind-addressed: every shape edit is a pure function in ./panelGridOps.ts that takes a
   * grid and returns one, and the caller — which is the thing looking at a window of a
   * known shape — says which of the three it just reshaped.
   */
  setGridFor(kind: LayoutKind, grid: PanelGrid): void
  /** Restore one breakpoint's grid to the shipped default. */
  resetGridFor(kind: LayoutKind): void
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
  const [config, setConfig] = useState<EditorConfig>(() =>
    active && typeof window !== 'undefined'
      ? hydrateConfig(window.localStorage.getItem(CONFIG_KEY))
      : seedConfig(),
  )
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
    setConfig(prev => {
      const next = op(prev)
      persistConfig(next)
      return next
    })
  }, [])

  const content = useContentEdits(apply, setSelected)

  const setGridFor = useCallback(
    (kind: LayoutKind, grid: PanelGrid) => apply(prev => setGrid(prev, kind, grid)),
    [apply],
  )

  const resetGridFor = useCallback(
    (kind: LayoutKind) => {
      apply(prev => resetGrid(prev, kind))
      // The default grid has fewer vertices than a bent one, so a surviving vertex
      // selection would point past the end of the table or at somebody else's corner.
      setSelected(null)
    },
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
    }),
    [content, active, config, selected, mode, setMode, select, clear, resetAll, setGridFor, resetGridFor],
  )
}
