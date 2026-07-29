/**
 * Dev-server file-watching policy. Imported by `vite.config.ts`; never by app
 * code, so it stays out of the production bundle.
 *
 * On Windows the frontend containers bind-mount source straight off NTFS, and
 * inotify events don't cross the 9p boundary — Vite's native watcher never sees
 * edits and HMR silently dies. Polling is the only fix. But every poll is a
 * VM->NTFS round-trip, so `interval` is a real CPU knob: at 100ms the two
 * worktree stacks pegged ~2 cores of the WSL2 VM continuously on a ~16 GB
 * laptop (see root CLAUDE.md, "Local dev: Docker resource footprint").
 */

/**
 * Lowest poll interval that keeps 9p stat traffic off the CPU budget. Anything
 * tighter re-introduces the pegged-core problem; don't lower without
 * re-measuring VM load average.
 */
export const MIN_SAFE_POLL_INTERVAL_MS = 300

/** Interval used inside Docker. Coarse on purpose, but still sub-second HMR. */
export const DOCKER_POLL_INTERVAL_MS = 500

export interface DevWatchOptions {
  usePolling: true
  interval: number
}

/**
 * Chokidar options for the dev server, or `undefined` to keep Vite's fast native
 * watcher. Gated on CHOKIDAR_USEPOLLING, which is set only in docker-compose, so
 * local non-Docker dev is unaffected.
 */
export function resolveDevWatch(
  env: Record<string, string | undefined>,
): DevWatchOptions | undefined {
  return env.CHOKIDAR_USEPOLLING
    ? { usePolling: true, interval: DOCKER_POLL_INTERVAL_MS }
    : undefined
}
