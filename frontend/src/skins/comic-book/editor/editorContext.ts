import { createContext, useContext } from 'react'

import type { LayoutKind } from '../panelGeometry'
import type { CallScenePhase } from '../phoneActions'
import { SHIPPED_LAYOUT } from '../layoutSource'
import type { ConfigDrift } from './configDrift'
import type { EditMode, Selection, SelectionKind } from './selection'
import type { EditorConfig } from './types'
import type { CallEdits } from './useCallEdits'
import type { ContentEdits } from './useContentEdits'
import type { GridEdits } from './useGridEdits'

// The seam that keeps the editor *engine* out of a production build.
//
// `Layout.tsx` has to ask for editor state on every render — it is a hook, so the call
// cannot be conditional — and for as long as it asked `useEditorMode` directly, that one
// edge pulled the whole engine into the lazy `comic-book` chunk: useWorkingCopy,
// useContentEdits, useCallEdits, useGridEdits, configPanels, configPages, configOps and
// editorStorage, 31.2 KB of it, downloaded by every production visitor to render a page
// none of it can change. Only the overlay's *UI* was ever behind the `import.meta.env.DEV`
// gate, and the size of what was not is what `../../../bundlePolicy.ts` records five
// consecutive ceiling raises for.
//
// So the page reads state from a context whose default is inert, and the engine moves
// behind the same DEV-gated `lazy()` the overlay already uses (./EditorProvider.tsx).
// Nothing here imports a mutator as a *value*, which is the whole property: every import
// above is `import type` and erases, so Rollup sees the engine reached only from the
// dynamic import that a production build folds away. `bundlePolicy.test.ts` asserts that
// against the real `dist/` rather than trusting this paragraph.

/**
 * What the drawn page reads off the editor — and all it may read, because this is the
 * half that has to exist in a build with no editor in it.
 *
 * The mutators are deliberately not here. A component that can reach one is a component
 * that keeps the engine alive, so wanting a mutator is the signal that the code belongs
 * under ./ with the rest of the overlay rather than on the page.
 */
export interface EditorView {
  /** True only in a dev session with the editor switched on; always false in a build. */
  active: boolean
  /** The working copy while one is open. Inert: the config the bundle shipped. */
  config: EditorConfig
  selected: Selection | null
  /**
   * The window shape the page is being held at, or null to follow the window. A page has
   * one grid per shape and the frame is letterboxed at that shape's aspect whatever the
   * window's, so an author tunes the portrait grid on a landscape monitor by picking it
   * here rather than by dragging the window narrow. Transient: it is a way of looking,
   * not part of the design, so it is neither saved nor persisted.
   */
  shape: LayoutKind | null
  /** Which call layout the author is previewing, or null for the telephone's own state. */
  callPhase: CallScenePhase | null
}

/**
 * The editor's full surface: what the page reads, plus every mutator the overlay drives.
 *
 * Lives here rather than beside the hook that builds it so that ./useEditorMode.ts can be
 * the one module naming the mutator *implementations* — see the note at the top of this
 * file for why that separation is the thing being protected.
 */
export interface EditorModeApi extends EditorView, ContentEdits, CallEdits, GridEdits {
  /**
   * True when this working copy was hydrated from a different `layoutConfig.ts` than the
   * one the bundle holds — a merge, a checkout or another tab's Save moved the file under
   * it — so writing it out would revert whatever changed there. See ./configStamp.ts.
   */
  stale: boolean
  /**
   * What the file gained since this copy started, per panel — the detail under `stale`, or
   * null for a copy that cannot say. See ./configDrift.ts.
   */
  drift: ConfigDrift | null
  /** True for a copy carrying no record of the file it came from, so drift is unknowable. */
  untracked: boolean
  /** Take the file's version of one panel, keeping this tab's work on the others. */
  adoptFromFile(panel: number): void
  mode: EditMode
  setMode(mode: EditMode): void
  setShape(shape: LayoutKind | null): void
  select(kind: SelectionKind, index: number): void
  clear(): void
  resetAll(): void
  /** Rename one panel. */
  setPanelLabel(panel: number, label: string): void
  /** Override one route's display name for this skin. */
  setPageLabel(path: string, label: string): void
}

/**
 * The editor as a page sees it when there is no editor: switched off, nothing selected,
 * following the window, drawing what the bundle shipped.
 *
 * Frozen and shared rather than built per render, because it is a dependency of the memos
 * that compute every polygon on the page and a fresh object each render would recompute
 * all of them each frame — the same reason `SHIPPED_LAYOUT` is built once.
 */
export const INERT_EDITOR: EditorView = Object.freeze({
  active: false,
  config: SHIPPED_LAYOUT,
  selected: null,
  shape: null,
  callPhase: null,
})

/**
 * Null outside a dev editor session, which is every production render and every test that
 * does not mount ./EditorProvider.tsx.
 */
export const EditorContext = createContext<EditorModeApi | null>(null)

/**
 * The editor's view of the page. Inert when no engine is mounted, which is what makes
 * this callable from the page unconditionally.
 */
export function useEditorMode(): EditorView {
  return useContext(EditorContext) ?? INERT_EDITOR
}

/**
 * The full editor surface, or null when no engine is mounted.
 *
 * For the overlay and its inspectors only — see {@link EditorView} for why the page does
 * not get this one.
 */
export function useEditorApi(): EditorModeApi | null {
  return useContext(EditorContext)
}

/**
 * True when picture `index` should render unclipped (a "full reveal") for framing: the
 * editor is active and that picture is the current selection. PanelImages uses this to
 * drop the frame clip on the selected picture so the whole of it stays visible while
 * you drag/zoom it — the outline SVG still marks where the crop lands.
 *
 * Here rather than with the hook because `Layout.tsx` calls it as a *value*, and a value
 * import from the engine's module is exactly the edge this file exists to cut.
 */
export function shouldRevealImg(
  active: boolean,
  selected: EditorView['selected'],
  index: number,
): boolean {
  return active && selected?.kind === 'img' && selected.index === index
}
