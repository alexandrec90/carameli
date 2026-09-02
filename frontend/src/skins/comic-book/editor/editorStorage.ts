import { logger } from '../../../lib/logger'
import { CONFIG_KEY, hydrateConfig, seedConfig } from './configOps'
import type { EditorConfig } from './types'

// Where the editor's two persisted things live: the flag that says it is on, and the
// working copy itself. Split out of useEditorMode.ts because none of it is React — it is
// the browser edges (a query param, localStorage, a quota error) that the hook wants
// behind a function it can call once.

const FLAG_KEY = 'comic-book:edit'

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
export function detectActive(): boolean {
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

/**
 * Write the working copy back to localStorage; a failure is a warning, never a throw.
 *
 * `stamp` names the `layoutConfig.ts` this working copy was hydrated from and `base` *is*
 * that file — see ./configStamp.ts for what the first is for and ./configDrift.ts for what
 * the second buys over it. Both are siblings of the config's own fields rather than a
 * wrapper so that every payload written before either existed stays readable by
 * {@link hydrateConfig}, which takes the fields it knows and ignores the rest.
 *
 * A null `base` is written as no key at all rather than as `null`, so "this payload
 * predates the base" and "this payload has an empty base" cannot be confused — the first
 * is a real state (every copy in a browser before this shipped) and the second is not one.
 */
export function persistConfig(config: EditorConfig, stamp: string, base: EditorConfig | null): void {
  try {
    const payload: Record<string, unknown> = { ...config, seedStamp: stamp }
    if (base !== null) payload.seedBase = base
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(payload))
  } catch (err) {
    logger.warn('Could not persist comic-book editor config', { key: CONFIG_KEY, err: String(err) })
  }
}

/**
 * The stamp a persisted payload carries, or null when it has none — absent, unparseable,
 * or written before stamps existed. Pure, so the hook can read it from the same string it
 * hands {@link hydrateConfig} rather than touching storage twice.
 */
export function storedStamp(raw: string | null): string | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { seedStamp?: unknown }
    return typeof parsed?.seedStamp === 'string' ? parsed.seedStamp : null
  } catch {
    return null
  }
}

/**
 * The `layoutConfig.ts` a persisted payload was hydrated from, or null when it carries
 * none — which every payload written before this shipped does.
 *
 * Taken **verbatim**, and deliberately not through {@link hydrateConfig}. Hydration is
 * right for a working copy and wrong for a base: `hydrateImage` merges each picture over
 * *the seed entry at the same index*, which is how a payload saved before pictures had a
 * src comes back as the shipped page rather than as eight copies of the template — and
 * which, applied to a base, silently re-supplies from today's file every field the old one
 * lacked. The `call` role is exactly such a field, so the base would come back already
 * holding the call layout it is supposed to prove the file gained, and the report this
 * exists for would be empty in the one case it was written for.
 *
 * A base needs no backfilling anyway: unlike a working copy it is never authored and never
 * hand-edited, and every one was written by {@link persistConfig} from a whole config. What
 * it does need is a structural guard, since it is read back out of a browser store that
 * anything can have written — and a base that fails it is no base, not a repaired one:
 * ./configDrift.ts reads *differences* off it, so a repair invents drift or hides it.
 */
export function storedBase(raw: string | null): EditorConfig | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { seedBase?: Partial<EditorConfig> }
    const base = parsed?.seedBase
    if (!base || typeof base !== 'object') return null
    const complete = ['panels', 'images', 'bubbles', 'chains', 'callScenes', 'patterns'] as const
    if (!complete.every(key => Array.isArray(base[key]))) return null
    return base as EditorConfig
  } catch {
    return null
  }
}

/** What a load starts from: the working copy, the file it came from, and that file. */
export interface BootWorkingCopy {
  config: EditorConfig
  stamp: string | null
  base: EditorConfig | null
}

/**
 * Read all three off the persisted payload, from **one** string. Reading storage once and
 * answering every question from that string is what stops a write landing between two
 * reads and pairing a config with another payload's stamp or base.
 *
 * `active` is false outside edit mode, where there is no working copy at all and the seed
 * is simply the layout.
 */
export function bootWorkingCopy(active: boolean): BootWorkingCopy {
  if (!active || typeof window === 'undefined') {
    return { config: seedConfig(), stamp: null, base: null }
  }
  const raw = window.localStorage.getItem(CONFIG_KEY)
  // No payload at all is not an untracked copy: it is a copy that *is* the file, so it
  // gets today's seed as its base and is tracked from its first edit.
  if (raw === null) return { config: seedConfig(), stamp: null, base: seedConfig() }
  return { config: hydrateConfig(raw), stamp: storedStamp(raw), base: storedBase(raw) }
}

/** Drop the working copy, so the next load re-seeds from the constants. */
export function clearStoredConfig(): void {
  try {
    window.localStorage.removeItem(CONFIG_KEY)
  } catch (err) {
    logger.warn('Could not clear comic-book editor config', { key: CONFIG_KEY, err: String(err) })
  }
}
