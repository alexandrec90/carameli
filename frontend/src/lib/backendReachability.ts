/**
 * Whether there is a backend behind the dev proxy at all.
 *
 * A host-Vite branch preview (devkit's `preview-ui-host.py`) serves the frontend
 * with nothing behind it: when the static checkout's stack is down, the preview
 * aims Vite's proxy at an offline stub that answers 502 to every request. That is
 * the designed state for a UI-only review — but the app cannot tell it from a real
 * outage, so every hook that loads on mount reports a failure, and the logger ships
 * each failure back through the same dead proxy, which fails too. One page load
 * becomes a console full of red for a preview working exactly as intended.
 *
 * This module is the single place that records "there is no backend". Once armed:
 *
 *  - `api/client.ts` rejects calls without touching the network, so moving around
 *    the preview stops replaying the same wall of requests;
 *  - `lib/logger.ts` stops posting entries to a sink that cannot receive them, and
 *    writes the app's own load failures through `console.warn` instead of
 *    `console.error` — same text, not styled as an app fault.
 *
 * It arms only under `import.meta.env.DEV`, so a production 502 is still news, is
 * still logged as an error, and still retries on the next call. Nothing disarms it:
 * bring the backend up and reload. A preview session is short, and a flag that
 * re-armed itself would put the failing requests back one probe at a time.
 */

/**
 * 502 is what Vite reports for a proxy target it cannot reach and what the preview
 * stub answers; 504 covers a target that accepts the connection and never replies.
 * 503 is deliberately absent — a real backend uses it to mean "up, not ready yet",
 * which is a condition worth retrying and worth logging as an error.
 */
const UNREACHABLE_STATUSES = new Set([502, 504])

let offline = false

export function isBackendOffline(): boolean {
  return offline
}

export function isUnreachableStatus(status: number): boolean {
  return UNREACHABLE_STATUSES.has(status)
}

/**
 * Record that the backend is absent. No-op in a production build.
 * Returns whether this call is the one that armed it.
 */
export function markBackendOffline(): boolean {
  if (offline || !import.meta.env.DEV) return false
  offline = true
  return true
}

/** Test-only: forget the observation. Nothing in the app calls this. */
export function resetBackendReachability(): void {
  offline = false
}
