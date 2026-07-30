import { describe, expect, it } from 'vitest'

import {
  DOCKER_POLL_INTERVAL_MS,
  MIN_SAFE_POLL_INTERVAL_MS,
  resolveDevWatch,
} from './devWatchPolicy'

/**
 * Pins both halves of the watcher trade-off documented in devWatchPolicy.ts:
 * polling must stay on in Docker (else HMR silently dies across the NTFS bind
 * mount), and the interval must stay coarse (else it pegs the WSL2 VM).
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
})
