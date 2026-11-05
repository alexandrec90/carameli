import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../../lib/logger'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('logger', () => {
  it.each([
    ['debug', '[DEBUG] hello'],
    ['info', '[INFO] hello'],
    ['warn', '[WARN] hello'],
    ['error', '[ERROR] hello'],
  ] as const)('writes %s to its own console channel', (level, text) => {
    const channel = vi.spyOn(console, level).mockImplementation(() => undefined)

    logger[level]('hello', { key: 'value' })

    expect(channel).toHaveBeenCalledWith(text, { key: 'value' })
  })

  it('never touches the network', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    logger.error('hello')

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
