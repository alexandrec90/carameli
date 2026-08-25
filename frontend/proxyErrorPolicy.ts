/**
 * Dev-server proxy error policy. Imported by `vite.config.ts`; never by app
 * code, so it stays out of the production bundle.
 *
 * A down backend is a *normal* state for this dev server: devkit's host-Vite
 * branch previews deliberately aim `VITE_PROXY_TARGET` at a dead port so API
 * calls fail fast and the UI falls back to its offline state, and plain local
 * dev often runs with the Docker stack stopped. In that state Vite logs a red
 * `http proxy error` block with a full Node stack trace for every proxied
 * request â€” and the stack is connection-refused internals with no app frames,
 * so it carries nothing the first line doesn't. One page load probes
 * `/auth/session` and reads as a wall of errors for behaviour that is working
 * as designed.
 *
 * {@link quietProxyErrors} wraps the dev-server logger: a proxy error keeps its
 * first line (the failing URL) plus a note saying what the failure means, an
 * identical line repeating inside {@link PROXY_ERROR_MUTE_MS} is dropped, and
 * every other error passes through untouched. Vite still answers the request
 * with 502 â€” its own error handler does that after logging â€” so the app's
 * offline fallback is unaffected.
 */
import type { Logger } from 'vite'

/** Repeats of the same proxy-error line are muted for this long. */
export const PROXY_ERROR_MUTE_MS = 10_000

const HINT =
  ' â€” backend unreachable; the call returned 502 and the UI shows its offline' +
  ` state. Start the backend stack for live data. Repeats muted for ${
    PROXY_ERROR_MUTE_MS / 1000
  }s.`

/**
 * The condensed replacement for one proxy-error log call, or `null` when the
 * same line was already shown inside the mute window. Exported for the test;
 * `vite.config.ts` goes through {@link quietProxyErrors}.
 */
export function condenseProxyError(
  msg: string,
  lastShown: Map<string, number>,
  now: number,
): string | null {
  const firstLine = msg.split('\n', 1)[0]
  const last = lastShown.get(firstLine)
  if (last !== undefined && now - last < PROXY_ERROR_MUTE_MS) return null
  lastShown.set(firstLine, now)
  return firstLine + HINT
}

/**
 * Wraps `logger.error` so proxy errors are condensed and everything else passes
 * through. Mutates and returns the logger it is handed, so `hasWarned` and the
 * other methods keep Vite's own bookkeeping.
 */
export function quietProxyErrors(logger: Logger, now: () => number = Date.now): Logger {
  const lastShown = new Map<string, number>()
  const error = logger.error.bind(logger)
  logger.error = (msg, options) => {
    if (msg.includes('http proxy error')) {
      const condensed = condenseProxyError(msg, lastShown, now())
      if (condensed !== null) error(condensed, options)
      return
    }
    error(msg, options)
  }
  return logger
}
