import { useLayoutEffect, useSyncExternalStore } from 'react'

// ── One loading screen, and the gates below it ───────────────────────────────
//
// A skin whose loading config is `persistent` (`skins/registry.ts`) has its screen
// mounted by `SkinProvider` under the app for the skin's whole life, rather than one
// screen per thing that loads. The gates below it — the session in `App.tsx`, a page's
// pictures in the comic-book Layout — say what is still loading through this store, and
// the screen keeps its legend up while any of them holds.
//
// A hold is taken in a layout effect, not a passive one, so it is counted before the
// browser paints the commit that mounted the holder: the chunk gate opens in the very
// render that mounts `App`, and `App`'s hold has to be in the count before that render
// is on screen, or the screen sees a moment with nothing loading and takes its legend
// down — which is the legend popping once per gate, the thing this replaces.

let holds = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** Take a hold on the loading screen. Returns the release, which is idempotent. */
export function holdLoading(): () => void {
  holds += 1
  notify()
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
    notify()
  }
}

/** Whether anything holds the loading screen. */
export function isLoadingHeld(): boolean {
  return holds > 0
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Hold the loading screen while `active`. */
export function useLoadingHold(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return
    return holdLoading()
  }, [active])
}

/** Whether anything below the loading screen is still loading; re-renders as it changes. */
export function useLoadingHeld(): boolean {
  return useSyncExternalStore(subscribe, isLoadingHeld, isLoadingHeld)
}

/**
 * A Suspense fallback that holds the loading screen for as long as it is mounted: the
 * chunk the boundary is waiting for is loading, and nothing else in the tree can say so.
 */
export function LoadingHold(): null {
  useLoadingHold(true)
  return null
}
