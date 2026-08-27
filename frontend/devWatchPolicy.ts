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
 *
 * The interval is only half the cost, and the half that had been measured. The
 * other half is *how many paths* each tick stats, and it does not show up as CPU
 * — it shows up as latency, because chokidar's `fs.stat` calls run on **libuv's
 * threadpool, which defaults to four threads**. Static file serving (`sirv` ->
 * `fs.read`) draws on that same pool, so once a sweep saturates it every asset
 * request queues behind the sweep. Measured on this stack, requesting the 8
 * comic-book panel images in parallel exactly as the browser preloads them:
 *
 * | polling | UV_THREADPOOL_SIZE | wall clock |
 * | ------- | ------------------ | ---------- |
 * | on      | 4 (Node default)   | 35.3 s     |
 * | off     | 4                  |  1.7 s     |
 * | on      | 64                 |  1.4 s     |
 *
 * The middle row is why this was mistaken for an asset-weight problem for so
 * long: turning polling off "fixes" it, which points the finger at the images.
 * The bottom row is the actual shape of the bug — the same bytes, the same
 * polling, 25x faster — so the fix is two-sided and both sides are load-bearing.
 * docker-compose sets `UV_THREADPOOL_SIZE` so a sweep cannot starve a response,
 * and {@link WATCH_IGNORED} keeps the sweep off paths that could never trigger a
 * hot update anyway.
 */

/**
 * Lowest poll interval that keeps 9p stat traffic off the CPU budget. Anything
 * tighter re-introduces the pegged-core problem; don't lower without
 * re-measuring VM load average.
 */
export const MIN_SAFE_POLL_INTERVAL_MS = 300

/** Interval used inside Docker. Coarse on purpose, but still sub-second HMR. */
export const DOCKER_POLL_INTERVAL_MS = 500

/**
 * Paths excluded from the poll sweep, on top of Vite's own defaults.
 *
 * Vite already ignores `.git` and `node_modules`. It does **not** ignore `dist/`,
 * which in this repo is a full copy of `public/` — including ~30 MB of PNG
 * masters — restat'd twice a second for a directory the dev server never reads.
 * Nothing listed here can produce a hot update, so ignoring it costs no HMR
 * fidelity: a changed image or font needs a reload either way.
 */
export const WATCH_IGNORED: readonly string[] = [
  '**/dist/**',
  '**/coverage/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/.vite/**',
  '**/public/**/*.{png,jpg,jpeg,webp,avif,gif,ico,mp4,woff,woff2,ttf,otf}',
]

export interface DevWatchOptions {
  usePolling: true
  interval: number
  // Mutable, unlike WATCH_IGNORED itself: this object is handed straight to
  // `server.watch`, whose chokidar type takes a mutable array, so a `readonly`
  // one here fails the assignment in vite.config.ts (TS2769) — a compile error
  // nothing caught while `lint:types` checked only `src/`.
  ignored: string[]
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
    ? {
        usePolling: true,
        interval: DOCKER_POLL_INTERVAL_MS,
        ignored: [...WATCH_IGNORED],
      }
    : undefined
}
