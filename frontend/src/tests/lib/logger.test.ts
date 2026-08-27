import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Logger = typeof import('../../lib/logger').logger
type Reachability = typeof import('../../lib/backendReachability')

let logger: Logger
// Imported through the same fresh module registry the logger gets, so marking the
// backend offline here is the same observation the logger reads.
let reachability: Reachability

async function importFreshLogger(): Promise<void> {
  vi.resetModules()
  reachability = await import('../../lib/backendReachability')
  const loggerModule = await import('../../lib/logger')
  logger = loggerModule.logger
}

/** Let an unawaited `flush()` and the fetch it awaits run to completion. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function respondWith(status: number) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    text: async () => '',
  })
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
      text: async () => '',
    }),
  )

  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  await importFreshLogger()
})

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('logger', () => {
  it('writes info to console.info', () => {
    logger.info('dashboard loaded', { route: '/' })

    expect(console.info).toHaveBeenCalledWith('[INFO] dashboard loaded', {
      route: '/',
    })
  })

  it('writes error to console.error', () => {
    logger.error('API call failed', { status: 502 })

    expect(console.error).toHaveBeenCalledWith('[ERROR] API call failed', {
      status: 502,
    })
  })

  it('flushes immediately on error level', () => {
    const fetchMock = vi.mocked(fetch)

    logger.error('provider down', { status: 502 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/vg/1.0.0/frontend-logs')
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    })

    const payload = JSON.parse(String(options.body)) as {
      entries: Array<{ level: string; message: string; context?: Record<string, unknown> }>
    }
    expect(payload.entries).toHaveLength(1)
    expect(payload.entries[0]).toMatchObject({
      level: 'error',
      message: 'provider down',
      context: { status: 502 },
    })
  })

  it('batches non-error entries', async () => {
    const fetchMock = vi.mocked(fetch)

    logger.info('first event')
    logger.warn('second event')

    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(String(options.body)) as {
      entries: Array<{ level: string; message: string }>
    }

    expect(payload.entries).toHaveLength(2)
    expect(payload.entries.map((entry) => entry.level)).toEqual(['info', 'warn'])
    expect(payload.entries.map((entry) => entry.message)).toEqual([
      'first event',
      'second event',
    ])
  })
})

describe('shipping to a sink that is down', () => {
  it('gives up after three consecutive refusals', async () => {
    const fetchMock = respondWith(500)
    vi.stubGlobal('fetch', fetchMock)
    await importFreshLogger()

    for (let i = 0; i < 6; i += 1) {
      logger.error(`boom ${i}`)
      await settle()
    }

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps shipping when a refusal is followed by a success', async () => {
    const fetchMock = respondWith(204)
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)
    await importFreshLogger()

    for (let i = 0; i < 5; i += 1) {
      logger.error(`boom ${i}`)
      await settle()
    }

    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('does not ship at all once the backend is known to be absent', async () => {
    const fetchMock = vi.mocked(fetch)
    reachability.markBackendOffline()

    logger.error('Failed to load extensions for the softphone')
    logger.info('still rendering')
    await vi.advanceTimersByTimeAsync(2000)
    await settle()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('an error raised by an absent backend', () => {
  it('keeps its text and stops being styled as an app fault', () => {
    reachability.markBackendOffline()

    logger.error('Failed to load extensions for the softphone', { error: '502' })

    expect(console.warn).toHaveBeenCalledWith(
      '[ERROR] Failed to load extensions for the softphone',
      { error: '502' },
    )
    expect(console.error).not.toHaveBeenCalled()
  })

  it('is an ordinary console error while the backend is presumed there', () => {
    logger.error('Failed to load extensions for the softphone', { error: '500' })

    expect(console.error).toHaveBeenCalledWith(
      '[ERROR] Failed to load extensions for the softphone',
      { error: '500' },
    )
  })
})
