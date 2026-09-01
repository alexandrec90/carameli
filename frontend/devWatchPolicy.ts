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
 * to be longer than the sweep it schedules.** At 500 ms the polls could not finish
 * before the next was due, so the watcher never idled and the 9p channel never went
 * quiet — which does not present as a watcher fault at all, but as every page load
 * taking seconds. {@link DOCKER_POLL_INTERVAL_MS} carries the measurement, and
 * {@link OBSERVED_SWEEP_MS} carries the method, which turned out to matter more.
 * The table above is a *parallel-asset* benchmark and stayed green throughout, because
 * warm modules are answered from memory and never queue on 9p; that is exactly why this
 * survived the fix that produced the bottom row.
 *
 * **And there is a fourth, which this file cannot fix: none of the above touches render
 * delay.** With the watcher quiet, `index.html` is served in ~50 ms and LCP on the
 * comic-book page was still 7.3 s, because 91% of it is the browser walking an
 * unbundled 13-level module graph after that first byte lands. Fixing the watcher moved
 * TTFB 2.4x and moved LCP by 2%. A timing that does not name which half it measured says
 * almost nothing about this stack.
 *
 * **`server.warmup` is the obvious answer to that fourth cost and it is the wrong one.**
 * It was written, committed and reverted here on 2026-09-01, so it is worth naming to
 * stop the next attempt: warmup pre-transforms modules into Vite's in-memory cache, and
 * the 6638 ms render delay was traced on a *reload*, with all 143 script requests
 * answered `304 Not Modified` from a cache that was **already warm**. A fix whose
 * mechanism is fully in effect during the measurement cannot be the cause of what was
 * measured. It is not free either — enabling it took the container's `ready in` from
 * ~29 s to ~73 s, moving the cost to startup rather than removing it.
 *
 * What is left, unfixed and named honestly: **143 requests deep in 13 serialized
 * levels over HTTP/1.1**, which caps the browser at ~6 connections per origin. Depth is
 * the part no number of connections can help — the browser cannot ask for a module until
 * the one that imports it has arrived and been parsed — so the lever is graph *shape*,
 * not cache temperature. Nobody should reach for `warmup` again without first re-checking whether
 * the modules in their trace were 200s or 304s.
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
 * Measured 2026-08-31 inside `carameli-frontend-1` over the 514 files left after
 * {@link WATCH_IGNORED}, with `UV_THREADPOOL_SIZE=64` as docker-compose sets it:
 * **312 ms, 469 ms, 701 ms** across three rounds.
 *
 * ## Measure it the way chokidar does, or the number is meaningless
 *
 * This constant first shipped as `2020`, taken from a **serialized** `statSync` loop —
 * one round trip at a time, waiting for each. That is not what the watcher does:
 * chokidar's `fs.watchFile` timers issue their stats through libuv's threadpool, so up
 * to 64 are in flight at once and they pipeline down the 9p channel instead of
 * round-tripping one by one. Both methods, same tree, same minute:
 *
 * | method | round 1 | round 2 | round 3 |
 * | ------ | ------- | ------- | ------- |
 * | serialized `statSync` (wrong) | 12988 ms | 12161 ms | 7353 ms |
 * | threadpool `fs.stat` (what chokidar does) | 701 ms | 312 ms | 469 ms |
 *
 * The serialized figure overstates by **15-39x**, and it is not even stable — re-run it
 * on a busier host and it says 12 s where yesterday it said 2 s. An agent who
 * re-measures that way and honours the "interval must beat the sweep" rule below would
 * raise the interval past 12 s and make HMR useless, having followed the instructions
 * exactly. So the method is the load-bearing part of this comment, not the number:
 * **stat concurrently, with the threadpool size the container actually runs.**
 */
export const OBSERVED_SWEEP_MS = 701

/**
 * Interval used inside Docker. Coarse on purpose, and it must stay coarser than
 * {@link OBSERVED_SWEEP_MS}.
 *
 * **This was 500 ms, which is below the sweep's own cost, so the watcher never
 * idled.** That is a different failure from the pegged cores the interval was first
 * tuned against, and it does not look like a watcher problem at all: it presents as
 * *page load* latency. `chokidar` polls each file on its own `fs.watchFile` timer, so
 * 514 files at 500 ms is ~1000 stats/second held permanently in flight, and every one of
 * them is a round trip down the single 9p channel to Windows. Anything the dev server
 * has to read from disk — `index.html` on every navigation, a cold module, a `public/`
 * asset — queues behind that traffic. Measured on the comic-book page: `index.html` took
 * 1.5-4.3 s to serve while a *warm* module, answered from Vite's in-memory transform
 * cache without touching the filesystem, took 30 ms. The container burned 35% CPU
 * serving nothing.
 *
 * An interval under the sweep does not overlap by a fixed multiple, which is worth
 * saying because the first draft of this comment quoted one (`~3.4x`, arithmetic on a
 * badly-measured sweep — see {@link OBSERVED_SWEEP_MS}). It is a feedback loop: the
 * extra stats in flight make the channel slower, which makes the sweep longer, which
 * puts still more in flight. The multiplier is whatever the loop settles at, and the
 * only stable statement is the qualitative one — below its own sweep, the backlog grows.
 *
 * **After the fix, verified 2026-08-31:** `index.html` 48-131 ms from the host,
 * TTFB 1618 ms -> 679 ms, and idle container CPU dipping to 5.6% where it had sat
 * flat at 35.4% — that dip *is* the watcher idling, and it is the observable worth
 * re-checking, more than any single timing.
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
