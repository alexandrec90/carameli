import { describe, expect, it } from 'vitest'

import { createMemoryStorage, installStorage, storageWorks } from './webStorage'

describe('the memory storage substitute', () => {
  it('round-trips, removes and clears', () => {
    const storage = createMemoryStorage()
    storage.setItem('skin', 'comic-book')
    expect(storage.getItem('skin')).toBe('comic-book')
    expect(storage.length).toBe(1)
    expect(storage.key(0)).toBe('skin')

    storage.removeItem('skin')
    expect(storage.getItem('skin')).toBeNull()

    storage.setItem('a', '1')
    storage.setItem('b', '2')
    storage.clear()
    expect(storage.length).toBe(0)
  })

  it('reports a missing key as null rather than undefined', () => {
    // `SkinProvider` branches on `=== null`, so a `Storage` handing back `undefined`
    // would take the wrong branch while looking like it worked.
    expect(createMemoryStorage().getItem('absent')).toBeNull()
    expect(createMemoryStorage().key(3)).toBeNull()
  })

  it('coerces keys and values to strings, as the real Storage does', () => {
    const storage = createMemoryStorage()
    storage.setItem(1 as unknown as string, 2 as unknown as string)
    expect(storage.getItem('1')).toBe('2')
  })
})

describe('installing it', () => {
  it('leaves a working storage alone', () => {
    const working = createMemoryStorage()
    working.setItem('skin', 'carameli')
    const target = { localStorage: working }

    expect(installStorage(target, 'localStorage')).toBe(false)
    // The guard is what makes this a no-op on CI's Node 20, where happy-dom's own
    // storage is in place: replacing it would throw away whatever a test had stored.
    expect(target.localStorage).toBe(working)
    expect(target.localStorage.getItem('skin')).toBe('carameli')
  })

  it('replaces a shadowing accessor that yields undefined', () => {
    // The exact shape Node >= 22.4 leaves behind: the key is present, the value is not.
    const target = {}
    Object.defineProperty(target, 'localStorage', {
      get: () => undefined,
      configurable: true,
    })
    expect('localStorage' in target).toBe(true)

    expect(installStorage(target, 'localStorage')).toBe(true)
    const installed = (target as { localStorage: Storage }).localStorage
    installed.setItem('skin', 'comic-book')
    expect(installed.getItem('skin')).toBe('comic-book')
  })

  it('fills in a key that is absent entirely', () => {
    const target: Record<string, unknown> = {}
    expect(installStorage(target, 'localStorage')).toBe(true)
    expect(storageWorks(target, 'localStorage')).toBe(true)
  })

  it('rejects a value that is not a usable Storage', () => {
    expect(storageWorks({ localStorage: undefined }, 'localStorage')).toBe(false)
    expect(storageWorks({ localStorage: null }, 'localStorage')).toBe(false)
    expect(storageWorks({ localStorage: {} }, 'localStorage')).toBe(false)
  })
})

describe('the environment the suite actually runs in', () => {
  it('has a usable localStorage and sessionStorage', () => {
    // The reversion check: drop the `setupFiles` entry and this fails on Node >= 22.4
    // while still passing on CI's Node 20 — so it is asserted here as well as relied on
    // by every test that stores a skin.
    expect(storageWorks(globalThis, 'localStorage')).toBe(true)
    expect(storageWorks(globalThis, 'sessionStorage')).toBe(true)

    localStorage.setItem('skin', 'comic-book')
    expect(localStorage.getItem('skin')).toBe('comic-book')
    localStorage.removeItem('skin')
  })
})
