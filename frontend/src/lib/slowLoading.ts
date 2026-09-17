import { logger } from './logger'

// ── `?slow=1`: the dev-only brake on the boot sequence ───────────────────────
//
// Every loading screen in the app is drawn behind a debounce and torn down the instant
// the thing it waits for arrives. That is the right behaviour for a visitor and it makes
// the screens impossible to *look at* on a warm dev machine: the skin chunk comes from
// the module cache, the session request is answered on localhost, and a page of cached
// pictures fires its load events in the same frame, so all three gates open inside their
// own debounce and nothing is ever painted. The exit is the part that suffers most —
// the comic-book page wipes in over the paper it was loading on, and there is no way to
// tune a transition you cannot see run.
//
// `?slow=1` drops every debounce to zero and holds each gate open for a second, so each
// screen paints and each transition out of it plays at the pace a first-time visitor on
// a cold cache sees. `?slow=0` turns it off; in between it is remembered in
// `localStorage['loading:slow']`, so switching skins from the picker — which reloads
// nothing and drops no query, but does re-run the chunk gate — stays slow too.
//
// Three gates share the flag: the skin chunk (`skins/context.tsx`), the session
// (`App.tsx`), and the comic-book page's pictures (`skins/comic-book/pageReveal.ts`).
// Each holds for its own second rather than sharing one deadline, because the point is
// to watch them one at a time — a shared deadline would be spent by the first gate and
// the last one, the only one with a transition, would never hold at all. For the
// comic-book skin the three hold one screen (`hooks/useLoadingHold.ts`), so what you
// see is three seconds of the same paper and legend, then the wipe.
//
// Dev-only twice over, like the simulation flags: this resolves to 0 outside
// `import.meta.env.DEV`, and {@link SLOW_LOADING_MS} repeats the test inline so a
// production build folds it to the constant and drops everything below.

const FLAG_KEY = 'loading:slow'

/** How long a gate is held by a plain `?slow=1`. "A good second." */
export const SLOW_LOAD_MS = 1000

/** Ceiling on `?slow=<ms>`, so a stray digit cannot make the app look wedged. */
export const MAX_SLOW_MS = 30_000

/**
 * A `slow` value as milliseconds, or null when it says nothing usable and the next
 * source should decide. `1` is the shorthand every other dev flag here spells the same
 * way; any other whole number is that many milliseconds, so a screen whose animation
 * outlasts a second can be watched without editing {@link SLOW_LOAD_MS}.
 */
function parseSlow(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  if (value === '1') return SLOW_LOAD_MS
  return Math.min(Number(value), MAX_SLOW_MS)
}

/**
 * How long this load should hold its loading screens, and what the persisted flag should
 * become (`null` = removed) so the outcome survives client-side navigation that drops the
 * query. Same contract as the simulation flags' `resolveSimFlag` — `1` on, `0` off, the
 * stored value deciding when the query says nothing — and it stores the resolved
 * milliseconds rather than `1`, so re-reading it is a fixed point.
 */
export function resolveSlowFlag(
  param: string | null,
  stored: string | null,
): { ms: number; storedFlag: string | null } {
  const ms = parseSlow(param) ?? parseSlow(stored) ?? 0
  return { ms, storedFlag: ms > 0 ? String(ms) : null }
}

/** Read `?slow` against the persisted flag, and persist the outcome. 0 when off. */
export function detectSlowLoading(): number {
  if (!import.meta.env.DEV || typeof window === 'undefined') return 0
  const param = new URLSearchParams(window.location.search).get('slow')
  try {
    const stored = window.localStorage.getItem(FLAG_KEY)
    const { ms, storedFlag } = resolveSlowFlag(param, stored)
    if (storedFlag !== stored) {
      if (storedFlag === null) window.localStorage.removeItem(FLAG_KEY)
      else window.localStorage.setItem(FLAG_KEY, storedFlag)
    }
    return ms
  } catch (err) {
    logger.warn('Could not persist the slow-loading flag', { key: FLAG_KEY, err: String(err) })
    return resolveSlowFlag(param, null).ms
  }
}

/**
 * Milliseconds every loading gate holds this load, 0 when the brake is off. Resolved once
 * at module load, like the simulation flags, so three gates cannot disagree about it.
 */
export const SLOW_LOADING_MS = import.meta.env.DEV ? detectSlowLoading() : 0

/**
 * The debounce a loading screen should use. `normal` while the brake is off; none while
 * it is on, because a screen held for a second that only appears after 400 ms of it is
 * not the screen a cold visitor sees.
 */
export function slowLoaderDelay(normal: number, ms: number = SLOW_LOADING_MS): number {
  return ms > 0 ? 0 : normal
}

/**
 * Hold a promised gate — the skin chunk — open for at least `ms`. The identity function
 * while the brake is off, so the ordinary path allocates nothing.
 */
export function slowLoad<T>(promise: Promise<T>, ms: number = SLOW_LOADING_MS): Promise<T> {
  if (ms <= 0) return promise
  const brake = new Promise<void>(resolve => setTimeout(resolve, ms))
  return Promise.all([promise, brake]).then(([value]) => value)
}
