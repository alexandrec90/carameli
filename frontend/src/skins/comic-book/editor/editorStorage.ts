import { logger } from '../../../lib/logger'
import { CONFIG_KEY } from './configOps'
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
 * `stamp` names the `layoutConfig.ts` this working copy was hydrated from and rides along
 * unchanged through every edit — see ./configStamp.ts for what it is for. It is a sibling
 * of the config's own fields rather than a wrapper so that every payload written before
 * it existed stays readable by {@link hydrateConfig}, which takes the fields it knows and
 * ignores the rest.
 */
export function persistConfig(config: EditorConfig, stamp: string): void {
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, seedStamp: stamp }))
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

/** Drop the working copy, so the next load re-seeds from the constants. */
export function clearStoredConfig(): void {
  try {
    window.localStorage.removeItem(CONFIG_KEY)
  } catch (err) {
    logger.warn('Could not clear comic-book editor config', { key: CONFIG_KEY, err: String(err) })
  }
}
