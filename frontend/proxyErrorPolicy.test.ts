import { describe, expect, it } from 'vitest'
import type { Logger } from 'vite'

import {
  PROXY_ERROR_MUTE_MS,
  condenseProxyError,
  quietProxyErrors,
} from './proxyErrorPolicy'

/**
 * Pins the trade documented in proxyErrorPolicy.ts: a down backend (the normal
 * state for host-Vite branch previews) must not spam a stack trace per proxied
 * request, and everything that is not a proxy error must reach the terminal
 * exactly as Vite wrote it.
 */

const PROXY_MSG = 'http proxy error: /auth/session\nError: connect ECONNREFUSED'

function fakeLogger() {
  const calls: string[] = []
  const logger = {
    error: (msg: string) => {
      calls.push(msg)
    },
  } as unknown as Logger
  return { logger, calls }
}

describe('condenseProxyError', () => {
  it('keeps the failing URL and drops the stack', () => {
    const line = condenseProxyError(PROXY_MSG, new Map(), 0)

    expect(line).toContain('http proxy error: /auth/session')
    expect(line).not.toContain('ECONNREFUSED')
    expect(line).toContain('offline')
  })

  it('mutes an identical line inside the window and shows it again after', () => {
    const lastShown = new Map<string, number>()

    expect(condenseProxyError(PROXY_MSG, lastShown, 0)).not.toBeNull()
    expect(condenseProxyError(PROXY_MSG, lastShown, PROXY_ERROR_MUTE_MS - 1)).toBeNull()
    expect(condenseProxyError(PROXY_MSG, lastShown, PROXY_ERROR_MUTE_MS)).not.toBeNull()
  })

  it('does not let one URL mute a different one', () => {
    const lastShown = new Map<string, number>()
    condenseProxyError(PROXY_MSG, lastShown, 0)

    expect(condenseProxyError('http proxy error: /vsapi/feed\nstack', lastShown, 1)).not.toBeNull()
  })
})

describe('quietProxyErrors', () => {
  it('condenses proxy errors and mutes their repeats', () => {
    const { logger, calls } = fakeLogger()
    let clock = 0
    quietProxyErrors(logger, () => clock)

    logger.error(PROXY_MSG)
    clock = 1
    logger.error(PROXY_MSG)

    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain('ECONNREFUSED')
  })

  it('passes every other error through untouched', () => {
    const { logger, calls } = fakeLogger()
    quietProxyErrors(logger, () => 0)

    logger.error('[comic-editor] save failed: boom')

    expect(calls).toEqual(['[comic-editor] save failed: boom'])
  })
})
