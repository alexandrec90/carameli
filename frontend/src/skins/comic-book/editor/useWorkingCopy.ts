import { useCallback, useMemo, useState } from 'react'

import { CONFIG_KEY, hydrateConfig, seedConfig } from './configOps'
import { isStaleWorkingCopy, seedStamp } from './configStamp'
import { clearStoredConfig, persistConfig, storedStamp } from './editorStorage'
import type { EditorConfig } from './types'

// The working copy itself: what the author has changed, where it is persisted, and which
// `layoutConfig.ts` it came from. Everything else about the editor — the selection, the
// mode, which mutator is being called — is ./useEditorMode.ts, which composes this.

export interface WorkingCopy {
  /** The layout as it stands in this tab. */
  config: EditorConfig
  /**
   * True when this copy was hydrated from a different `layoutConfig.ts` than the one the
   * bundle holds — a merge, a checkout or another tab's Save moved the file under it — so
   * writing it out would revert whatever changed there. See ./configStamp.ts.
   */
  stale: boolean
  /** Apply a pure config operation, persisting whatever comes back. */
  apply(op: (prev: EditorConfig) => EditorConfig): void
  /** Drop the copy for the file itself, so the next load re-seeds from the constants. */
  reset(): void
}

/**
 * The working copy and its persistence. `active` is false outside edit mode, where there
 * is no copy at all and the seed is simply the layout.
 */
export function useWorkingCopy(active: boolean): WorkingCopy {
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

  const reset = useCallback(() => {
    // Drop the persisted override entirely so the next load re-seeds from the
    // constants (a true "back to source defaults"), then reflect that in state.
    clearStoredConfig()
    setConfig(seedConfig())
    // The working copy *is* the file again, so whatever it used to predate it no longer
    // does — leaving the old stamp here would warn about a config that came from the very
    // bundle it is being compared with.
    setStamp(current)
  }, [current])

  return useMemo(
    () => ({ config, stale: isStaleWorkingCopy(stamp), apply, reset }),
    [config, stamp, apply, reset],
  )
}
