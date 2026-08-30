import { describe, expect, it } from 'vitest'

import {
  DOCKER_POLL_INTERVAL_MS,
  MIN_SAFE_POLL_INTERVAL_MS,
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

  it('keeps the poll sweep off assets-src/, the encode script inputs nothing serves', () => {
    expect(resolveDevWatch({ CHOKIDAR_USEPOLLING: 'true' })?.ignored)
      .toContain('**/assets-src/**')
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
