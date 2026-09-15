import { useCallback, useMemo, useState } from 'react'

import type { LayoutKind } from '../panelGeometry'
import { setPanelLabel as setPanelLabelIn } from './configPanels'
import { setPageLabel as setPageLabelIn } from './configPages'
import type { EditorModeApi } from './editorContext'
import { detectActive } from './editorStorage'
import type { EditMode, Selection, SelectionKind } from './selection'
import { useCallEdits } from './useCallEdits'
import { useContentEdits } from './useContentEdits'
import type { ApplyOp } from './useContentEdits'
import { useGridEdits } from './useGridEdits'
import { useWorkingCopy } from './useWorkingCopy'

// The pure operations on a config live in ./configOps.ts and ./panelGridOps.ts, the
// mutators in ./useContentEdits.ts, ./useCallEdits.ts and ./useGridEdits.ts, the browser
// edges in ./editorStorage.ts and the working copy's own state in ./useWorkingCopy.ts;
// this module is the React state between them — the edit flag, the selection, and which
// half of the editor is in front.
//
// **Nothing on the drawn page may import this module for a value.** It is the root of the
// engine, and one value edge from `Layout.tsx` put all of it in the production bundle for
// five consecutive ceiling raises — see ./editorContext.ts, which is what the page imports
// instead and which carries the whole account. The page gets here through
// ./EditorProvider.tsx and a DEV-gated `lazy()`, or it does not get here at all.

// No type re-exports here any more. They used to let a caller reach `EditorModeApi`, and
// `Selection` behind it, through the engine's own module — harmless while the types were
// declared here, and exactly the habit that made the value import in `Layout.tsx` look
// ordinary. Types come from ./editorContext.ts and ./selection.ts, which is where they
// are, and this module exports the engine and nothing else.

/** The two renames: a panel's name and a route's display name, each a config op. */
function useLabelEdits(apply: ApplyOp) {
  const setPanelLabel = useCallback(
    (panel: number, label: string) => apply(prev => setPanelLabelIn(prev, panel, label)),
    [apply],
  )
  const setPageLabel = useCallback(
    (path: string, label: string) => apply(prev => setPageLabelIn(prev, path, label)),
    [apply],
  )
  return { setPanelLabel, setPageLabel }
}

/**
 * The window shape the page is held at, or null to follow the window. Switching it drops
 * the selection: each grid has its own vertex table, so a vertex index carried across
 * would name a different corner or none.
 */
function useHeldShape(
  setSelected: (next: Selection | null) => void,
): [LayoutKind | null, (next: LayoutKind | null) => void] {
  const [shape, setShapeState] = useState<LayoutKind | null>(null)
  const setShape = useCallback((next: LayoutKind | null) => {
    setShapeState(prev => {
      if (prev !== next) setSelected(null)
      return next
    })
  }, [setSelected])
  return [shape, setShape]
}

/**
 * Dev-only editor state for the comic-book skin. Holds a working copy of the panel
 * transforms and grids (seeded from constants, persisted to localStorage), a current
 * selection, and mutators. Inert (active: false) outside `import.meta.env.DEV` / the
 * edit flag.
 *
 * Called from ./EditorProvider.tsx and from tests, and from nowhere on the page: the name
 * says "engine" rather than "mode" because calling it is what decides whether every module
 * below it is downloaded by a visitor who has no editor. `useEditorMode` is now the
 * context reader in ./editorContext.ts, which is the one the page is meant to reach for.
 */
export function useEditorEngine(): EditorModeApi {
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

  const [shape, setShape] = useHeldShape(setSelected)

  const clear = useCallback(() => setSelected(null), [])

  // The call edits first: the content adds need to know which layout is on screen, and
  // that is the switch this hook holds.
  const call = useCallEdits(apply, setSelected)
  const content = useContentEdits(apply, setSelected, call.callPhase)
  const grid = useGridEdits(apply, setSelected, config)

  const { setPanelLabel, setPageLabel } = useLabelEdits(apply)

  const resetAll = useCallback(() => {
    copy.reset()
    setSelected(null)
  }, [copy])

  // The selection goes with it: adopting a panel splices both entry lists, so the index a
  // selection holds can land on a different picture than the one that was outlined — and
  // silently editing the wrong entry is exactly the failure this whole module is for.
  const adoptFromFile = useCallback((panel: number) => {
    copy.adopt(panel)
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
      drift: copy.drift,
      untracked: copy.untracked,
      adoptFromFile,
      selected,
      mode,
      setMode,
      shape,
      setShape,
      select,
      clear,
      resetAll,
      setPanelLabel,
      setPageLabel,
    }),
    [
      content, call, grid, active, config, copy.stale, copy.drift, copy.untracked,
      adoptFromFile, selected, mode, setMode, shape, setShape, select, clear, resetAll,
      setPanelLabel, setPageLabel,
    ],
  )
}
