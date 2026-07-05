import { useCallback, useMemo, useState } from 'react'

import { logger } from '../../../lib/logger'
import { PANEL_IMG_TRANSFORMS, PANEL_BUBBLE_TRANSFORMS } from './layoutConfig'
import type { BubbleTransform, EditorConfig, ImgTransform } from './types'

// ─── localStorage keys ─────────────────────────────────────────────────────────

const FLAG_KEY = 'comic-book:edit'
const CONFIG_KEY = 'comic-book:editConfig'

export interface EditorModeApi {
  active: boolean
  config: EditorConfig
  selected: { kind: 'img' | 'bubble'; index: number } | null
  select(kind: 'img' | 'bubble', index: number): void
  clear(): void
  setImg(index: number, patch: Partial<ImgTransform>): void
  setBubble(index: number, patch: Partial<BubbleTransform>): void
  resetOne(kind: 'img' | 'bubble', index: number): void
  resetAll(): void
}

// ─── Pure helpers (unit-testable without React) ─────────────────────────────────

/** Deep clone of the on-disk constants — the canonical "default" config. */
export function seedConfig(): EditorConfig {
  return {
    images: PANEL_IMG_TRANSFORMS.map(t => ({ ...t })),
    bubbles: PANEL_BUBBLE_TRANSFORMS.map(b => ({ ...b })),
  }
}

/** Deep clone of an arbitrary config (no shared references with the input). */
export function cloneConfig(c: EditorConfig): EditorConfig {
  return {
    images: c.images.map(t => ({ ...t })),
    bubbles: c.bubbles.map(b => ({ ...b })),
  }
}

/**
 * Build a config from a persisted JSON string. Falls back to {@link seedConfig}
 * for null, malformed JSON, or a structurally invalid payload — never throws.
 */
export function hydrateConfig(raw: string | null): EditorConfig {
  if (raw == null) return seedConfig()
  try {
    const parsed = JSON.parse(raw) as Partial<EditorConfig>
    if (
      !parsed ||
      !Array.isArray(parsed.images) ||
      !Array.isArray(parsed.bubbles) ||
      parsed.images.length !== PANEL_IMG_TRANSFORMS.length ||
      parsed.bubbles.length !== PANEL_BUBBLE_TRANSFORMS.length
    ) {
      return seedConfig()
    }
    // Backfill any fields missing from older payloads (pre-spill/type/text) by
    // merging each entry over its seed default, so an upgrade never leaves undefined.
    const seed = seedConfig()
    return {
      images: parsed.images.map((t, i) => ({ ...seed.images[i], ...t })),
      bubbles: parsed.bubbles.map((b, i) => ({ ...seed.bubbles[i], ...b })),
    }
  } catch (err) {
    logger.warn('Discarding malformed comic-book editor config', { key: CONFIG_KEY, err: String(err) })
    return seedConfig()
  }
}

/**
 * True when panel `index`'s image should render unclipped (a "full reveal") for
 * framing: the editor is active and that image is the current selection. Layout uses
 * this to drop the panel clip on the selected image so the whole picture stays visible
 * while you drag/zoom it — the panel outline still marks where the crop lands.
 */
export function shouldRevealImg(
  active: boolean,
  selected: EditorModeApi['selected'],
  index: number,
): boolean {
  return active && selected?.kind === 'img' && selected.index === index
}

/** Patch-merge a single image entry, returning a new config. */
export function patchImg(
  config: EditorConfig,
  index: number,
  patch: Partial<ImgTransform>,
): EditorConfig {
  const next = cloneConfig(config)
  if (next.images[index]) next.images[index] = { ...next.images[index], ...patch }
  return next
}

/** Patch-merge a single bubble entry, returning a new config. */
export function patchBubble(
  config: EditorConfig,
  index: number,
  patch: Partial<BubbleTransform>,
): EditorConfig {
  const next = cloneConfig(config)
  if (next.bubbles[index]) next.bubbles[index] = { ...next.bubbles[index], ...patch }
  return next
}

/** Restore a single entry to its constant default, returning a new config. */
export function resetOneIn(
  config: EditorConfig,
  kind: 'img' | 'bubble',
  index: number,
): EditorConfig {
  const next = cloneConfig(config)
  const seed = seedConfig()
  if (kind === 'img' && seed.images[index]) next.images[index] = seed.images[index]
  if (kind === 'bubble' && seed.bubbles[index]) next.bubbles[index] = seed.bubbles[index]
  return next
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

// ─── Hook ───────────────────────────────────────────────────────────────────────

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

  const select = useCallback((kind: 'img' | 'bubble', index: number) => {
    setSelected({ kind, index })
  }, [])

  const clear = useCallback(() => setSelected(null), [])

  const setImg = useCallback(
    (index: number, patch: Partial<ImgTransform>) =>
      setConfig(prev => {
        const next = patchImg(prev, index, patch)
        persist(next)
        return next
      }),
    [],
  )

  const setBubble = useCallback(
    (index: number, patch: Partial<BubbleTransform>) =>
      setConfig(prev => {
        const next = patchBubble(prev, index, patch)
        persist(next)
        return next
      }),
    [],
  )

  const resetOne = useCallback(
    (kind: 'img' | 'bubble', index: number) =>
      setConfig(prev => {
        const next = resetOneIn(prev, kind, index)
        persist(next)
        return next
      }),
    [],
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
      resetOne,
      resetAll,
    }),
    [active, config, selected, select, clear, setImg, setBubble, resetOne, resetAll],
  )
}
