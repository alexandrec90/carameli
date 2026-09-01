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
 *
 * **There is a third side, and it was missing until 2026-08-31: the interval has
 * to be longer than the sweep it schedules.** At 500 ms against a ~2 s sweep the
 * polls overlapped ~3.4x, so the watcher never idled and the 9p channel never went
 * quiet — which does not present as a watcher fault at all, but as every page load
 * taking seconds. {@link DOCKER_POLL_INTERVAL_MS} carries the measurement and the
 * arithmetic. The table above is a *parallel-asset* benchmark and stayed green
 * throughout, because warm modules are answered from memory and never queue on 9p;
 * that is exactly why this survived the fix that produced the bottom row.
 */

/**
 * Lowest poll interval that keeps 9p stat traffic off the CPU budget. Anything
 * tighter re-introduces the pegged-core problem; don't lower without
 * re-measuring VM load average.
 */
export const MIN_SAFE_POLL_INTERVAL_MS = 300

/**
 * Longest a full sweep of the watched tree has been measured to take, in the
 * container, over the 9p bind mount. **The interval below must stay above this**,
 * and that is the whole reason this constant is written down.
 *
 * Measured 2026-08-31 inside `carameli-frontend-1`, stat-ing the 513 files left
 * after {@link WATCH_IGNORED}: 943 ms idle, 1689 ms and 2020 ms under load. It is
 * ~2-3 ms per file and it is 9p round-trip latency, not CPU — which is why it gets
 * *worse* exactly when the machine is busy serving a page.
 */
export const OBSERVED_SWEEP_MS = 2020

/**
 * Interval used inside Docker. Coarse on purpose, and it must stay coarser than
 * {@link OBSERVED_SWEEP_MS}.
 *
 * **This was 500 ms, which is below the sweep's own cost, so sweeps overlapped
 * ~3.4x and the watcher never idled.** That is a different failure from the pegged
 * cores the interval was first tuned against, and it does not look like a watcher
 * problem at all: it presents as *page load* latency. `chokidar` polls each file on
 * its own `fs.watchFile` timer, so 513 files at 500 ms is ~1000 stats/second held
 * permanently in flight, and every one of them is a round trip down the single 9p
 * channel to Windows. Anything the dev server has to read from disk — `index.html`
 * on every navigation, a cold module, a `public/` asset — queues behind that
 * traffic. Measured on the comic-book page: `index.html` took 1.5-4.3 s to serve
 * while a *warm* module, answered from Vite's in-memory transform cache without
 * touching the filesystem, took 30 ms. The container burned 35% CPU serving
 * nothing.
 *
 * `UV_THREADPOOL_SIZE=64` in docker-compose is the other half of this and is still
 * load-bearing — it stops the stats starving libuv's pool — but it cannot help with
 * the 9p channel, which is serialized regardless of how many stats are in flight.
 * Raising the interval is what actually reduces the traffic: 4x fewer stats per
 * second, and no overlap.
 *
 * The trade is HMR latency, and it is worth naming rather than discovering: an edit
 * now lands in the browser in up to ~2.5 s instead of ~0.5 s. For UI work where that
 * matters, the host dev server (`devkit/scripts/preview-ui-host.py`) has no bind
 * mount and no polling at all.
 */
export const DOCKER_POLL_INTERVAL_MS = 2500

/**
 * Paths excluded from the poll sweep, on top of Vite's own defaults.
 *
 * Vite already ignores `.git` and `node_modules`. It does **not** ignore `dist/`,
 * which in this repo is a full copy of `public/` — restat'd twice a second for a
 * directory the dev server never reads. Nothing listed here can produce a hot
 * update, so ignoring it costs no HMR fidelity.
 *
 * **`assets-src/` came off this list**, and for the same reason `public/` was never
 * on it: an event there is not an HMR trigger but an input to something else.
 * `comicAssetsWatch.ts` encodes a master the moment one lands, so ignoring the
 * directory would mean a picture dropped in appeared in the editor only after a
 * restart — the manual step the plugin exists to remove. The sweep cost is the same
 * argument as `public/`'s below: chokidar stats files, not bytes, and the ~40 MB of
 * masters are about thirty of them.
 *
 * **`public/` is never on this list, and that is load-bearing.** The dev server
 * does not stat `public/` per request: `initPublicFiles` reads the directory once
 * at startup into a Set, `servePublicMiddleware` answers only names in that Set,
 * and the *only* thing that keeps the Set current is the watcher's add/unlink
 * events. Ignore a path under `public/` and a picture written after startup is
 * served the SPA's `index.html` instead of its bytes — a silent 404 that survives
 * every reload and clears only on a container restart. This list previously
 * carried `public/**\/*.{png,webp,…}` on the reasoning that a binary asset cannot
 * hot-update, which is true and beside the point: the events are what the registry
 * is built from, not what HMR is triggered by. Two replaced comic-book panels
 * vanished from the page that way, and looked for all the world like a bad deploy.
 *
 * The sweep cost that reasoning was buying is smaller than it reads, because
 * chokidar stats *files*, not bytes: all of `public/` is ~44 of them.
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
