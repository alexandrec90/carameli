import { useCallback, useMemo, useState } from 'react'

import { adoptPanel } from './configAdopt'
import { configDrift, hasDrift } from './configDrift'
import type { ConfigDrift } from './configDrift'
import { CONFIG_KEY, hydrateConfig, seedConfig } from './configOps'
import { configStamp, isStaleWorkingCopy } from './configStamp'
import { clearStoredConfig, persistConfig, storedBase, storedStamp } from './editorStorage'
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
  /**
   * What the file gained since this copy was hydrated, per panel, or null for a copy that
   * cannot say — one persisted before the base existed. See ./configDrift.ts.
   */
  drift: ConfigDrift | null
  /**
   * True for a copy carrying no base at all, so nothing here can tell the author what a
   * Save would overwrite. Its own line in the toolbar, because the remedy differs: a
   * tracked copy adopts the panels it is behind on, an untracked one has to be Reset once
   * to start being tracked.
   */
  untracked: boolean
  /** Apply a pure config operation, persisting whatever comes back. */
  apply(op: (prev: EditorConfig) => EditorConfig): void
  /** Take the file's version of one panel, leaving the rest of this copy alone. */
  adopt(panel: number): void
  /** Drop the copy for the file itself, so the next load re-seeds from the constants. */
  reset(): void
}

/**
 * The working copy and its persistence. `active` is false outside edit mode, where there
 * is no copy at all and the seed is simply the layout.
 */
export function useWorkingCopy(active: boolean): WorkingCopy {
  // The payload is read once and answers three questions: what the working copy is, which
  // `layoutConfig.ts` it came from, and what that file held. All from the same string, so
  // a storage write between the reads cannot pair a config with another payload's base.
  const [boot] = useState(() => {
    if (!active || typeof window === 'undefined') {
      return { config: seedConfig(), stamp: null, base: null as EditorConfig | null }
    }
    const raw = window.localStorage.getItem(CONFIG_KEY)
    // No payload at all is not an untracked copy: it is a copy that *is* the file, so it
    // gets today's seed as its base and is tracked from its first edit.
    if (raw === null) return { config: seedConfig(), stamp: null, base: seedConfig() }
    return { config: hydrateConfig(raw), stamp: storedStamp(raw), base: storedBase(raw) }
  })
  const [config, setConfig] = useState<EditorConfig>(boot.config)
  // Never recomputed: the seed is a module constant, and a change to the file it comes
  // from restarts the bundle (Vite has no accept handler for it, so it full-reloads).
  const seed = useMemo(() => seedConfig(), [])
  const current = useMemo(() => configStamp(seed), [seed])
  const [stamp, setStamp] = useState<string | null>(boot.stamp)
  // The base moves for exactly two reasons — a Reset, which makes the copy the file again,
  // and adopting a panel, which makes it the file *on that panel*. Never on an ordinary
  // edit: that is the drift this exists to keep hold of, exactly as the stamp is.
  const [base, setBase] = useState<EditorConfig | null>(boot.base)

  const write = useCallback(
    (next: EditorConfig, nextStamp: string, nextBase: EditorConfig | null) => {
      persistConfig(next, nextStamp, nextBase)
    },
    [],
  )

  const apply = useCallback((op: (prev: EditorConfig) => EditorConfig) => {
    // A payload written before stamps existed adopts this bundle's on its first edit —
    // the one point at which "which file did this come from" has an answer that is at
    // least not a guess. An edit never *refreshes* a stamp that is already there: that is
    // exactly the staleness the stamp exists to keep hold of.
    //
    // The base gets no such courtesy. A stamp is a guess that costs a warning; a base is
    // the thing every drift line is read off, and today's seed is the one value it is
    // certainly not — the payload predates the field, so it predates this bundle too.
    // Claiming it would turn "the file moved under you" into silence.
    setStamp(prev => prev ?? current)
    setConfig(prev => {
      const next = op(prev)
      write(next, stamp ?? current, base)
      return next
    })
  }, [stamp, current, base, write])

  const adopt = useCallback((panel: number) => {
    if (base === null) return
    const nextBase = adoptPanel(base, seed, panel)
    setBase(nextBase)
    setConfig(prev => {
      const next = adoptPanel(prev, seed, panel)
      write(next, stamp ?? current, nextBase)
      return next
    })
  }, [base, seed, stamp, current, write])

  const reset = useCallback(() => {
    // Drop the persisted override entirely so the next load re-seeds from the
    // constants (a true "back to source defaults"), then reflect that in state.
    clearStoredConfig()
    setConfig(seedConfig())
    // The working copy *is* the file again, so whatever it used to predate it no longer
    // does — leaving the old stamp here would warn about a config that came from the very
    // bundle it is being compared with.
    setStamp(current)
    setBase(seedConfig())
  }, [current])

  const drift = useMemo(() => (base === null ? null : configDrift(base, seed)), [base, seed])

  return useMemo(
    () => ({
      config,
      // With a base the question is answered outright — the file either holds what this
      // copy came from or it does not — and the stamp is the fallback for a copy that has
      // no base to compare. The two agree wherever both apply: same canonical form.
      stale: base === null ? isStaleWorkingCopy(stamp) : hasDrift(drift),
      drift,
      untracked: base === null,
      apply,
      adopt,
      reset,
    }),
    [config, base, stamp, drift, apply, adopt, reset],
  )
}
