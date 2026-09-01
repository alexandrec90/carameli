import { describe, expect, it } from 'vitest'

import {
  DOCKER_POLL_INTERVAL_MS,
  MIN_SAFE_POLL_INTERVAL_MS,
  OBSERVED_SWEEP_MS,
  WATCH_IGNORED,
  resolveDevWatch,
} from './devWatchPolicy'

/**
 * Pins all three halves of the watcher trade-off documented in devWatchPolicy.ts:
 * polling must stay on in Docker (else HMR silently dies across the NTFS bind
 * mount), the interval must stay coarse (else it pegs the WSL2 VM), and the sweep
 * must stay off build output (else its stat calls starve libuv's threadpool and
 * every static asset request queues behind them).
 */

describe('resolveDevWatch', () => {
  it('polls in Docker, so HMR survives the NTFS bind mount', () => {
    expect(resolveDevWatch({ CHOKIDAR_USEPOLLING: 'true' })).toMatchObject({
      usePolling: true,
    })
  })

  it('keeps the poll interval coarse enough not to peg the WSL2 VM', () => {
    const watch = resolveDevWatch({ CHOKIDAR_USEPOLLING: 'true' })

    expect(watch?.interval).toBeGreaterThanOrEqual(MIN_SAFE_POLL_INTERVAL_MS)
    expect(DOCKER_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(MIN_SAFE_POLL_INTERVAL_MS)
  })

  it('keeps the interval longer than one sweep, so polls cannot overlap', () => {
    // The regression this exists to catch, and the reason it is a *separate* test from
    // the coarseness floor above: 500 ms against a ~2 s sweep passed that one and was
    // still wrong. Overlapping polls keep the 9p channel permanently busy, and every
    // request the dev server has to answer off disk queues behind them — so the symptom
    // is page-load latency (index.html: 1.5-4.3 s) and nothing points at the watcher.
    //
    // An interval below the sweep it schedules is a backlog by construction, whatever
    // the two numbers happen to be, so this compares them rather than pinning either.
    const watch = resolveDevWatch({ CHOKIDAR_USEPOLLING: 'true' })

    expect(watch?.interval).toBeGreaterThan(OBSERVED_SWEEP_MS)
    expect(DOCKER_POLL_INTERVAL_MS).toBeGreaterThan(OBSERVED_SWEEP_MS)
  })

  it('keeps native watching for local non-Docker dev', () => {
    expect(resolveDevWatch({})).toBeUndefined()
  })

  it('treats an empty CHOKIDAR_USEPOLLING as unset rather than enabling polling', () => {
    expect(resolveDevWatch({ CHOKIDAR_USEPOLLING: '' })).toBeUndefined()
  })

  it('keeps the poll sweep off dist/, which Vite does not ignore by default', () => {
    // dist/ is a byte-for-byte copy of public/ — ~30 MB of PNG masters restat'd
    // twice a second for a tree the dev server never serves from.
    expect(resolveDevWatch({ CHOKIDAR_USEPOLLING: 'true' })?.ignored).toContain('**/dist/**')
  })

  it('never ignores assets-src/, because a master landing there is what triggers an encode', () => {
    // It was ignored until `comicAssetsWatch.ts` existed, on the reasoning that nothing
    // serves a master. True, and beside the point once the add event is the input to the
    // encode: ignore it and a picture dropped in reaches the editor only after a restart.
    for (const pattern of WATCH_IGNORED) {
      expect(pattern).not.toMatch(/(^|\/)assets-src\//)
    }
  })

  it('never ignores public/, because that is where the served-file registry comes from', () => {
    // Vite reads public/ once at startup into a Set and answers requests only for
    // names in it; the watcher's add/unlink events are the only thing that keeps it
    // current. An ignored path under public/ therefore means a picture written after
    // startup is served index.html instead of its bytes, until the server restarts.
    for (const pattern of WATCH_IGNORED) {
      expect(pattern).not.toMatch(/(^|\/)public\//)
    }
  })

  it('never ignores src/, which is the only tree HMR exists to watch', () => {
    for (const pattern of WATCH_IGNORED) {
      expect(pattern).not.toMatch(/(^|\/)src\//)
    }
  })
})
