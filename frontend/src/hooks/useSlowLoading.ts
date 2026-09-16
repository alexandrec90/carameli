import { useEffect, useState } from 'react'
import { SLOW_LOADING_MS } from '../lib/slowLoading'

/**
 * The React half of the `?slow=1` brake (`lib/slowLoading.ts` is the flag and the
 * promise-side hold). A gate whose answer is a boolean rather than a promise — the
 * session in `App.tsx`, a page's pictures in the comic-book Layout — reports ready
 * through this instead, and it withholds that for `ms` from mount.
 *
 * Held from mount, not from the moment `ready` last went false: each of these gates is
 * one-way within a mount, and restarting the hold on a second wait would mean cancelling
 * a timer the instant the thing arrived, which is the one moment it must survive.
 *
 * `ms` defaults to the flag, and is a parameter so the behaviour is testable without a
 * URL: 0 makes this the identity on its argument and costs a single idle state.
 */
function useSlowReadyDev(ready: boolean, ms: number = SLOW_LOADING_MS): boolean {
  const [held, setHeld] = useState(ms > 0)

  useEffect(() => {
    if (ms <= 0) return
    const timer = setTimeout(() => setHeld(false), ms)
    return () => clearTimeout(timer)
  }, [ms])

  return ready && !held
}

/**
 * {@link useSlowReadyDev} in development, the identity on `ready` in a production build.
 *
 * The indirection is what keeps a debugging aid off a visitor's wire, which is the bar
 * `?sim=1`, `?smsSim=1` and `?callSim=1` already meet by being inline
 * `import.meta.env.DEV` tests at their call sites. A hook cannot be called conditionally,
 * so the test moves here: `import.meta.env.DEV` is a literal `false` in a production
 * build, so this is the arrow below and the hook above — `useState`, `useEffect` and a
 * timer, all of them doing nothing — is dropped as unreachable. It is chosen once at
 * build time rather than per render, so the hook order every caller reports is fixed for
 * the build's life, which is the part a ternary over a hook would otherwise break.
 */
export const useSlowReady: (ready: boolean, ms?: number) => boolean =
  import.meta.env.DEV ? useSlowReadyDev : (ready: boolean) => ready
