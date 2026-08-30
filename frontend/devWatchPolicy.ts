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
 *
 * **Nothing under `public/` may be listed here, whatever it costs to stat.** That
 * reasoning above — "a changed image needs a reload either way" — is true and was
 * still the wrong test to apply, because the watcher is not only feeding HMR. Vite
 * lists `public/` once at startup into a `Set` (`initPublicFiles`), serves a
 * request only if the URL is in that `Set` (`servePublicMiddleware` falls straight
 * through to the SPA fallback on a miss), and keeps the `Set` in sync **solely**
 * from the watcher's `add`/`unlink` events. Ignore an extension here and every
 * file with it becomes invisible to that sync: an image that did not exist at the
 * moment the server booted can never be served, and one that briefly vanished —
 * a `git checkout` across a branch that replaces it, which is delete-then-create
 * on disk — is dropped from the `Set` and never re-added. The symptom is not a
 * 404, which would at least look like a missing file: the SPA fallback answers
 * `200 text/html`, so the browser reports a decode failure on an image that is
 * sitting correctly on disk, correctly committed and correctly deployed.
 *
 * That is what this glob did on 2026-08-30. `hand-notepad.webp` and
 * `push-button-phone.webp` were replaced by #287, were byte-correct in the
 * container, and served `index.html` until the dev server was restarted — which
 * read as the change never having shipped. The stat traffic this bought back was
 * the whole of `public/` at a few dozen paths per tick, against `dist/` at
 * thousands; it was never where the cost was.
 */
export const WATCH_IGNORED: readonly string[] = [
  '**/dist/**',
  '**/coverage/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/.vite/**',
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
