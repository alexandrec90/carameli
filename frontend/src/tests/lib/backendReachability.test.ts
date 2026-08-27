import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isBackendOffline,
  isUnreachableStatus,
  markBackendOffline,
  resetBackendReachability,
} from '../../lib/backendReachability'

beforeEach(() => {
  resetBackendReachability()
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetBackendReachability()
})

describe('isUnreachableStatus', () => {
  it('covers the statuses a proxy with nothing behind it produces', () => {
    expect(isUnreachableStatus(502)).toBe(true)
    expect(isUnreachableStatus(504)).toBe(true)
  })

  it('leaves 503 alone — a real backend uses it for "up, not ready yet"', () => {
    expect(isUnreachableStatus(503)).toBe(false)
  })

  it('is false for ordinary application failures', () => {
    for (const status of [200, 400, 401, 404, 500]) {
      expect(isUnreachableStatus(status)).toBe(false)
    }
  })
})

describe('markBackendOffline', () => {
  it('reports nothing observed until something marks it', () => {
    expect(isBackendOffline()).toBe(false)
  })

  it('arms once, and says which call was the one that armed it', () => {
    expect(markBackendOffline()).toBe(true)
    expect(isBackendOffline()).toBe(true)

    expect(markBackendOffline()).toBe(false)
    expect(isBackendOffline()).toBe(true)
  })

  it('never arms in a production build, where a 502 is still news', () => {
    vi.stubEnv('DEV', false)

    expect(markBackendOffline()).toBe(false)
    expect(isBackendOffline()).toBe(false)
  })
})
