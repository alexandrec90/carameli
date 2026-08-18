import { useCallback, useMemo, useState } from 'react'

import { logger } from '../../../lib/logger'
import {
  CONFIG_KEY,
  addBubble,
  addImg,
  hydrateConfig,
  patchBubble,
  patchImg,
  removeBubble,
  removeImg,
  resetOneIn,
  seedConfig,
} from './configOps'
import type { BubbleTransform, EditorConfig, ImgTransform } from './types'

// The pure operations on a config live in ./configOps.ts; this module is the React
// state around them — the edit flag, the working copy, the selection, persistence.

const FLAG_KEY = 'comic-book:edit'

/**
 * What a selection can be. `'panel'` is a slot in the grid and indexes PANELS; the
 * other two index their own array in the config and are what the inspector edits.
 *
 * A panel is selectable at all because a picture no longer *is* its panel: adding one
 * needs a panel to add it to, and an empty panel would otherwise be unclickable.
 */
export type SelectionKind = 'panel' | 'img' | 'bubble'

/** A selectable thing: which array, and which entry of it. */
export interface Selection {
  kind: SelectionKind
  index: number
}

export interface EditorModeApi {
  active: boolean
  config: EditorConfig
  selected: Selection | null
  select(kind: SelectionKind, index: number): void
  clear(): void
  setImg(index: number, patch: Partial<ImgTransform>): void
  setBubble(index: number, patch: Partial<BubbleTransform>): void
  /** Append a picture on `panel` and select it. */
  addImgOn(panel: number): void
  /** Delete picture `index`, clearing the selection it leaves behind. */
  deleteImg(index: number): void
  /** Append a bubble on `panel` and select it. */
  addBubbleOn(panel: number): void
  /** Delete bubble `index`, clearing the selection it leaves behind. */
  deleteBubble(index: number): void
  resetOne(kind: 'img' | 'bubble', index: number): void
  resetAll(): void
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
 * Resolve the editor flag for this load. `?edit=1` switches the editor on and
 * `?edit=0` switches it off; either way `storedFlag` is what the persisted flag
 * should become (`null` = removed) so the outcome survives client-side
 * navigation that drops the query. With no usable param, the stored flag decides.
 */
export function resolveEditFlag(
  param: string | null,
  stored: string | null,
): { active: boolean; storedFlag: '1' | null } {
  if (param === '1') return { active: true, storedFlag: '1' }
  if (param === '0') return { active: false, storedFlag: null }
  const active = stored === '1'
  return { active, storedFlag: active ? '1' : null }
}

/** True when the dev editor should be active for this load. Persists the outcome. */
function detectActive(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  const param = new URLSearchParams(window.location.search).get('edit')
  try {
    const stored = window.localStorage.getItem(FLAG_KEY)
    const { active, storedFlag } = resolveEditFlag(param, stored)
    if (storedFlag !== stored) {
      if (storedFlag === null) window.localStorage.removeItem(FLAG_KEY)
      else window.localStorage.setItem(FLAG_KEY, storedFlag)
    }
    return active
  } catch (err) {
    logger.warn('Could not persist comic-book editor flag', { key: FLAG_KEY, err: String(err) })
    return resolveEditFlag(param, null).active
  }
}

function persist(config: EditorConfig): void {
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch (err) {
    logger.warn('Could not persist comic-book editor config', { key: CONFIG_KEY, err: String(err) })
  }
}

/**
 * Dev-only editor state for the comic-book skin. Holds a working copy of the panel
 * transforms (seeded from constants, persisted to localStorage), a current selection,
 * and mutators. Inert (active: false) outside `import.meta.env.DEV` / the edit flag.
 */
export function useEditorMode(): EditorModeApi {
  const [active] = useState(detectActive)
  const [config, setConfig] = useState<EditorConfig>(() =>
    active && typeof window !== 'undefined'
      ? hydrateConfig(window.localStorage.getItem(CONFIG_KEY))
      : seedConfig(),
  )
  const [selected, setSelected] = useState<EditorModeApi['selected']>(null)

  const select = useCallback((kind: SelectionKind, index: number) => {
    setSelected({ kind, index })
  }, [])

  const clear = useCallback(() => setSelected(null), [])

  /** Apply a pure config operation, persisting whatever comes back. */
  const apply = useCallback((op: (prev: EditorConfig) => EditorConfig) => {
    setConfig(prev => {
      const next = op(prev)
      persist(next)
      return next
    })
  }, [])

  const setImg = useCallback(
    (index: number, patch: Partial<ImgTransform>) => apply(prev => patchImg(prev, index, patch)),
    [apply],
  )

  const setBubble = useCallback(
    (index: number, patch: Partial<BubbleTransform>) =>
      apply(prev => patchBubble(prev, index, patch)),
    [apply],
  )

  const addImgOn = useCallback(
    (panel: number) => {
      let added = -1
      apply(prev => {
        const { config: next, index } = addImg(prev, panel)
        added = index
        return next
      })
      // The append is to the end, so the index is known without waiting for the state
      // to commit — selecting it here is what puts the new picture in the inspector.
      if (added >= 0) setSelected({ kind: 'img', index: added })
    },
    [apply],
  )

  const deleteImg = useCallback(
    (index: number) => {
      apply(prev => removeImg(prev, index))
      // Every later picture shifts down one, so any surviving selection would now point
      // at a different picture than the author was looking at. Drop it.
      setSelected(null)
    },
    [apply],
  )

  const addBubbleOn = useCallback(
    (panel: number) => {
      let added = -1
      apply(prev => {
        const { config: next, index } = addBubble(prev, panel)
        added = index
        return next
      })
      // The append is to the end, so the index is known without waiting for the state
      // to commit — selecting it here is what puts the new bubble in the inspector.
      if (added >= 0) setSelected({ kind: 'bubble', index: added })
    },
    [apply],
  )

  const deleteBubble = useCallback(
    (index: number) => {
      apply(prev => removeBubble(prev, index))
      // Every later bubble shifts down one, so any surviving selection would now point
      // at a different bubble than the author was looking at. Drop it.
      setSelected(null)
    },
    [apply],
  )

  const resetOne = useCallback(
    (kind: 'img' | 'bubble', index: number) => apply(prev => resetOneIn(prev, kind, index)),
    [apply],
  )

  const resetAll = useCallback(() => {
    // Drop the persisted override entirely so the next load re-seeds from the
    // constants (a true "back to source defaults"), then reflect that in state.
    try {
      window.localStorage.removeItem(CONFIG_KEY)
    } catch (err) {
      logger.warn('Could not clear comic-book editor config', { key: CONFIG_KEY, err: String(err) })
    }
    setConfig(seedConfig())
    setSelected(null)
  }, [])

  return useMemo(
    () => ({
      active,
      config,
      selected,
      select,
      clear,
      setImg,
      setBubble,
      addImgOn,
      deleteImg,
      addBubbleOn,
      deleteBubble,
      resetOne,
      resetAll,
    }),
    [
      active,
      config,
      selected,
      select,
      clear,
      setImg,
      setBubble,
      addImgOn,
      deleteImg,
      addBubbleOn,
      deleteBubble,
      resetOne,
      resetAll,
    ],
  )
}
