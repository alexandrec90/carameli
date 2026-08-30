import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import { configStamp, isStaleWorkingCopy, seedStamp } from '../../skins/comic-book/editor/configStamp'
import { persistConfig, storedStamp } from '../../skins/comic-book/editor/editorStorage'
import { useEditorMode } from '../../skins/comic-book/editor/useEditorMode'

// The guard against a Save that reverts the file. Written against the incident it exists
// for: a tab whose working copy came from an older `layoutConfig.ts` overwrote a merged
// change to the call-record table, and nothing anywhere said so.

const CONFIG_KEY = 'comic-book:editConfig'
const FLAG_KEY = 'comic-book:edit'

/** A payload as the editor writes one, with whatever stamp the case is about. */
const payload = (stamp: string | null) =>
  JSON.stringify(stamp === null ? seedConfig() : { ...seedConfig(), seedStamp: stamp })

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(FLAG_KEY, '1')
})

afterEach(() => {
  window.localStorage.clear()
})

describe('configStamp', () => {
  it('is stable for the same config and moves with a change to it', () => {
    const config = seedConfig()
    expect(configStamp(config)).toBe(configStamp(seedConfig()))
    expect(configStamp(config)).toBe(seedStamp())

    const renamed = { ...config, panels: config.panels.map((p, i) => (i === 0 ? { ...p, label: 'Cover' } : p)) }
    expect(configStamp(renamed)).not.toBe(seedStamp())
  })

  // The stamp says which file a copy came from, not what the author has done since, so a
  // config that would serialize identically stamps identically however it was built.
  it('reads the file the config would write, not the object it is', () => {
    const config = seedConfig()
    const rebuilt = { ...config, images: config.images.map(t => ({ ...t })) }
    expect(configStamp(rebuilt)).toBe(configStamp(config))
  })
})

describe('isStaleWorkingCopy', () => {
  it('is true only for a stamp that names another file', () => {
    expect(isStaleWorkingCopy(seedStamp())).toBe(false)
    expect(isStaleWorkingCopy('from-an-older-file')).toBe(true)
  })

  // A payload written before stamps existed cannot be judged, and a warning that fires on
  // every one of them would be dismissed on the day it was finally right.
  it('says nothing about a payload that carries no stamp', () => {
    expect(isStaleWorkingCopy(null)).toBe(false)
  })
})

describe('storedStamp', () => {
  it('reads back the stamp persistConfig wrote, with the config intact beside it', () => {
    persistConfig(seedConfig(), 'stamp-1')
    const raw = window.localStorage.getItem(CONFIG_KEY)
    expect(storedStamp(raw)).toBe('stamp-1')
    expect(JSON.parse(raw ?? '{}').panels).toHaveLength(seedConfig().panels.length)
  })

  it('answers null for absent, unparseable, and unstamped payloads', () => {
    expect(storedStamp(null)).toBeNull()
    expect(storedStamp('{oh no')).toBeNull()
    expect(storedStamp(payload(null))).toBeNull()
  })
})

describe('useEditorMode — a working copy that predates the file', () => {
  it('reports a payload stamped with another file as stale', () => {
    window.localStorage.setItem(CONFIG_KEY, payload('from-an-older-file'))
    const { result } = renderHook(() => useEditorMode())
    expect(result.current.active).toBe(true)
    expect(result.current.stale).toBe(true)
  })

  it('reports a payload stamped with this file as current', () => {
    window.localStorage.setItem(CONFIG_KEY, payload(seedStamp()))
    const { result } = renderHook(() => useEditorMode())
    expect(result.current.stale).toBe(false)
  })

  // The whole point: editing is not reconciling. An author who drags a balloon in a tab
  // that is behind the file has not looked at the file, so the warning has to survive it.
  it('keeps the warning through an edit, and keeps writing the old stamp', () => {
    window.localStorage.setItem(CONFIG_KEY, payload('from-an-older-file'))
    const { result } = renderHook(() => useEditorMode())

    act(() => result.current.setPanelLabel(0, 'Cover'))

    expect(result.current.stale).toBe(true)
    expect(storedStamp(window.localStorage.getItem(CONFIG_KEY))).toBe('from-an-older-file')
  })

  it('adopts this file’s stamp on the first edit of an unstamped payload', () => {
    window.localStorage.setItem(CONFIG_KEY, payload(null))
    const { result } = renderHook(() => useEditorMode())
    expect(result.current.stale).toBe(false)

    act(() => result.current.setPanelLabel(0, 'Cover'))

    expect(storedStamp(window.localStorage.getItem(CONFIG_KEY))).toBe(seedStamp())
    expect(result.current.stale).toBe(false)
  })

  // Reset drops the working copy for the file itself, which is exactly the reconciliation
  // the warning is asking for — so it has to clear it.
  it('clears the warning when the working copy is reset to the file', () => {
    window.localStorage.setItem(CONFIG_KEY, payload('from-an-older-file'))
    const { result } = renderHook(() => useEditorMode())
    expect(result.current.stale).toBe(true)

    act(() => result.current.resetAll())

    expect(result.current.stale).toBe(false)
    expect(window.localStorage.getItem(CONFIG_KEY)).toBeNull()
  })

  it('starts a fresh session — no payload at all — unwarned', () => {
    const { result } = renderHook(() => useEditorMode())
    expect(result.current.stale).toBe(false)
    act(() => result.current.setPanelLabel(0, 'Cover'))
    expect(storedStamp(window.localStorage.getItem(CONFIG_KEY))).toBe(seedStamp())
  })
})
