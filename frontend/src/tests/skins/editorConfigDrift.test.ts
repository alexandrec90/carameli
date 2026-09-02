import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PATTERN_STYLE_KEYS } from '../../skins/comic-book/panelPatterns'
import type { PanelBgStyle } from '../../skins/comic-book/panelPatterns'
import { adoptPanel } from '../../skins/comic-book/editor/configAdopt'
import { configDrift, driftLine, hasDrift } from '../../skins/comic-book/editor/configDrift'
import {
  addBubble,
  addCallScene,
  addImg,
  patchBubble,
  patchPattern,
  seedConfig,
} from '../../skins/comic-book/editor/configOps'
import { configStamp, seedStamp } from '../../skins/comic-book/editor/configStamp'
import {
  bootWorkingCopy, persistConfig, storedBase, storedStamp,
} from '../../skins/comic-book/editor/editorStorage'
import { setPanelLabel } from '../../skins/comic-book/editor/configPanels'
import { useEditorMode } from '../../skins/comic-book/editor/useEditorMode'
import type { EditorConfig } from '../../skins/comic-book/editor/types'

// What the file gained under a working copy, and taking one panel of it.
//
// The incident these are written against is the one that keeps happening: the editor's
// working copy outlives every merge, so a tab opened before the phone-call layout landed
// wrote its own callScenes-free version of `layoutConfig.ts` back over it, and the toggle
// that switches a panel between Default, Ringing and Connected vanished — three times, each
// time recovered by merging the two halves by hand in git.
//
// Staleness alone (editorConfigStamp.test.ts) says the file moved. These say *what* moved
// and let the author take it without discarding the afternoon's work, which is the only
// version of the warning anybody acts on.

const CONFIG_KEY = 'comic-book:editConfig'
const FLAG_KEY = 'comic-book:edit'

/** The page with nothing on it: every drift here is one the test put there. */
const bare = (): EditorConfig => ({
  ...seedConfig(),
  images: [],
  bubbles: [],
  chains: [],
  callScenes: [],
})

/** One entry with its call role taken off — a config as it was before calls existed. */
function withoutCall<T extends { call?: unknown }>(entry: T): T {
  const copy = { ...entry }
  delete copy.call
  return copy
}

/** The shipped page as it stood before any panel of it was a phone call. */
const beforeCalls = (): EditorConfig => {
  const seed = seedConfig()
  return {
    ...seed,
    images: seed.images.map(withoutCall),
    bubbles: seed.bubbles.map(withoutCall),
    callScenes: [],
  }
}

/** The panel `layoutConfig.ts` ships as a phone call. */
const callPanel = (): number => seedConfig().callScenes[0].panel

describe('configDrift', () => {
  it('reports nothing for a config that has not moved', () => {
    const drift = configDrift(seedConfig(), seedConfig())
    expect(drift).toEqual({ panels: [], page: [] })
    expect(hasDrift(drift)).toBe(false)
    expect(hasDrift(null)).toBe(false)
  })

  it('counts pictures and balloons added on a panel', () => {
    const base = bare()
    const seed = addBubble(addImg(base, 3).config, 3).config

    expect(configDrift(base, seed).panels).toEqual([
      { panel: 3, label: base.panels[3].label, changes: ['1 picture added', '1 balloon added'] },
    ])
  })

  it('counts a removal the other way round', () => {
    const base = addImg(addImg(bare(), 3).config, 3).config
    expect(configDrift(base, bare()).panels[0].changes).toEqual(['2 pictures removed'])
  })

  // Every field of an entry is in its key, so a picture whose framing was changed is a
  // removal and an addition of the same size. Reported as neither: what the author will
  // see on the panel is a picture that moved.
  it('reads an add and a remove of the same size as a change', () => {
    const base = addImg(bare(), 3).config
    const seed = { ...base, images: [{ ...base.images[0], scale: 1.8 }] }
    expect(configDrift(base, seed).panels[0].changes).toEqual(['1 picture changed'])
  })

  it('keeps a panel out of the report when only another panel moved', () => {
    const base = bare()
    const seed = addImg(base, 3).config
    expect(configDrift(base, seed).panels.map(p => p.panel)).toEqual([3])
  })

  it('names a rename and a background pattern', () => {
    const base = bare()
    const renamed = setPanelLabel(base, 2, 'Notepad')
    expect(configDrift(base, renamed).panels[0].changes).toEqual(['renamed'])

    const other = PATTERN_STYLE_KEYS.find(k => k !== base.patterns[2]) as PanelBgStyle
    const restyled = patchPattern(base, 2, other)
    expect(configDrift(base, restyled).panels[0].changes)
      .toEqual(['a different background pattern'])
  })

  // The line the user asked for by name: the panel that gained a phone call says so first,
  // above whatever pictures came with it.
  it('says a panel became a phone call, stopped being one, or moved its seam', () => {
    const base = bare()
    const calling = addCallScene(base, 4).config

    const became = configDrift(base, calling).panels[0]
    expect(became.panel).toBe(4)
    expect(became.changes[0]).toBe('became a phone call')

    expect(configDrift(calling, base).panels[0].changes[0]).toBe('stopped being a phone call')

    const moved = { ...calling, callScenes: calling.callScenes.map(s => ({ ...s, cut: 30 })) }
    expect(configDrift(calling, moved).panels[0].changes).toEqual(['the call seam moved'])
  })

  it('reports the page-level changes no single panel owns', () => {
    const base = bare()

    const relabelled = { ...base, pageLabels: { ...base.pageLabels, '/': 'Home Page' } }
    expect(configDrift(base, relabelled).page).toEqual(['a page was renamed'])

    const dropped = { ...base, panels: base.panels.slice(0, -1) }
    expect(configDrift(dropped, base).page).toEqual(['1 panel added to the page'])
    expect(configDrift(base, dropped).page).toEqual(['1 panel removed from the page'])
  })

  // A panel the file no longer has is not one to take: its slot belongs to nothing now, and
  // `adoptPanel` refuses it. The shrunk list is what the author is told about instead.
  it('does not offer a panel the file has dropped', () => {
    const five = addImg(bare(), 5).config
    const base = { ...five, panels: five.panels.slice(0, 5) }
    const shorter = { ...base, panels: base.panels.slice(0, 4) }
    const drift = configDrift(base, shorter)
    expect(drift.panels.map(p => p.panel)).not.toContain(5)
    expect(drift.page).toContain('1 panel removed from the page')
  })

  it('writes one panel as a line an author can read', () => {
    expect(driftLine({ panel: 8, label: 'Phone', changes: ['became a phone call', '3 pictures added'] }))
      .toBe('Phone — became a phone call, 3 pictures added')
  })
})

describe('adoptPanel', () => {
  it('takes the file’s phone call into a copy that lost it, and nothing else', () => {
    const panel = callPanel()
    const lost = beforeCalls()
    const author = setPanelLabel(lost, 0, 'Cover by the author')

    const taken = adoptPanel(author, seedConfig(), panel)

    // The call is back: the roles, and the seam the author never authored.
    expect(taken.callScenes.filter(s => s.panel === panel))
      .toEqual(seedConfig().callScenes.filter(s => s.panel === panel))
    expect(taken.images.filter(i => i.panel === panel && i.call !== undefined).length)
      .toBeGreaterThan(0)
    expect(taken.bubbles.filter(b => b.panel === panel && b.call !== undefined).length)
      .toBeGreaterThan(0)
    // And the tab's own work on another panel is untouched.
    expect(taken.panels[0].label).toBe('Cover by the author')
    expect(hasDrift(configDrift(taken, seedConfig()))).toBe(true)
  })

  it('stops the panel being reported, and leaves every other one reported', () => {
    const panel = callPanel()
    const base = beforeCalls()
    const behind = setPanelLabel(base, 0, 'Cover')

    const before = configDrift(base, seedConfig()).panels.map(p => p.panel)
    expect(before).toContain(panel)

    const after = configDrift(adoptPanel(base, seedConfig(), panel), seedConfig()).panels
    expect(after.map(p => p.panel)).not.toContain(panel)
    // The author's own panel is not the file's business either way.
    expect(configDrift(behind, seedConfig()).panels.map(p => p.panel)).toContain(0)
  })

  // `linkTo` is a global index into the bubble list, so replacing a panel's entries
  // renumbers every balloon after it. A tube on an untouched panel must still join the two
  // balloons it always joined.
  it('re-aims a link on another panel across the renumbering', () => {
    const withPair = addBubble(addBubble(bare(), 6).config, 6).config
    const linked = patchBubble(withPair, 0, { linkTo: 1 })
    // The file has three balloons on panel 2 where the copy has none, so both of the
    // linked pair move by three.
    const seed = addBubble(addBubble(addBubble(bare(), 2).config, 2).config, 2).config

    const taken = adoptPanel(linked, seed, 2)

    const pair = taken.bubbles
      .map((b, i) => ({ ...b, i }))
      .filter(b => b.panel === 6)
    expect(pair).toHaveLength(2)
    expect(pair[0].linkTo).toBe(pair[1].i)
  })

  it('drops a link that pointed into the panel being replaced', () => {
    const onOne = addBubble(addBubble(bare(), 1).config, 1).config
    const linked = patchBubble(onOne, 0, { linkTo: 1 })

    const taken = adoptPanel(linked, bare(), 1)

    expect(taken.bubbles.filter(b => b.panel === 1)).toHaveLength(0)
    expect(taken.bubbles.every(b => b.linkTo === null)).toBe(true)
  })

  it('appends the file’s entries on a panel the copy has nothing on', () => {
    const seed = addImg(bare(), 7).config
    const taken = adoptPanel(bare(), seed, 7)
    expect(taken.images.filter(i => i.panel === 7)).toHaveLength(1)
  })

  it('is a no-op for a panel the file does not have', () => {
    const config = addImg(bare(), 3).config
    expect(adoptPanel(config, seedConfig(), -1)).toBe(config)
    expect(adoptPanel(config, seedConfig(), seedConfig().panels.length)).toBe(config)
  })
})

describe('storedBase', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('reads back the base persistConfig wrote, beside the config and the stamp', () => {
    persistConfig(bare(), 'stamp-1', seedConfig())
    const raw = window.localStorage.getItem(CONFIG_KEY)

    expect(storedStamp(raw)).toBe('stamp-1')
    expect(configStamp(storedBase(raw) as EditorConfig)).toBe(seedStamp())
    // The working copy beside it is still the working copy, not the base.
    expect(JSON.parse(raw ?? '{}').images).toEqual([])
  })

  // The base is read back through `hydrateConfig`, so a config that has been in a browser
  // across releases is backfilled exactly as the working copy is. If the round trip were
  // lossy, a field added since would read as the file having gained it on every panel.
  it('round-trips today’s file without inventing a difference', () => {
    persistConfig(bare(), 'stamp-1', seedConfig())
    const base = storedBase(window.localStorage.getItem(CONFIG_KEY)) as EditorConfig
    expect(hasDrift(configDrift(base, seedConfig()))).toBe(false)
  })

  it('answers null for absent, unparseable, and baseless payloads', () => {
    expect(storedBase(null)).toBeNull()
    expect(storedBase('{oh no')).toBeNull()
    persistConfig(bare(), 'stamp-1', null)
    const raw = window.localStorage.getItem(CONFIG_KEY)
    expect(JSON.parse(raw ?? '{}')).not.toHaveProperty('seedBase')
    expect(storedBase(raw)).toBeNull()
  })
})

describe('bootWorkingCopy', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  // Outside edit mode there is no working copy to be behind anything, so a base would be
  // a drift report about a copy nobody is editing.
  it('is the plain seed, untracked, when the editor is off', () => {
    const boot = bootWorkingCopy(false)

    expect(configStamp(boot.config)).toBe(seedStamp())
    expect(boot.stamp).toBeNull()
    expect(boot.base).toBeNull()
  })

  // The distinction the `untracked` flag is read off: no payload is a copy that *is* the
  // file, so it gets a base and is tracked from its first edit — not an untracked one.
  it('gives a fresh session today’s file as its base', () => {
    const boot = bootWorkingCopy(true)

    expect(boot.stamp).toBeNull()
    expect(boot.base).not.toBeNull()
    expect(configStamp(boot.base as EditorConfig)).toBe(seedStamp())
  })

  it('reads the copy, the stamp and the base off one stored payload', () => {
    persistConfig(bare(), 'stamp-1', seedConfig())

    const boot = bootWorkingCopy(true)

    expect(boot.stamp).toBe('stamp-1')
    expect(configStamp(boot.base as EditorConfig)).toBe(seedStamp())
  })

  // A payload written before the base existed. It must come back with none rather than
  // with today's seed: claiming one would report no drift on the copy most likely to have
  // some. See `storedBase`'s header.
  it('leaves a payload that predates the base untracked', () => {
    persistConfig(bare(), 'stamp-1', null)

    const boot = bootWorkingCopy(true)

    expect(boot.stamp).toBe('stamp-1')
    expect(boot.base).toBeNull()
  })
})

describe('useEditorMode — a copy that is behind the file', () => {
  /** A payload as a tab that started before the calls existed would hold. */
  const behindPayload = (config: EditorConfig) =>
    JSON.stringify({ ...config, seedStamp: configStamp(beforeCalls()), seedBase: beforeCalls() })

  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(FLAG_KEY, '1')
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('names the phone-call panel the file gained, rather than only saying it moved', () => {
    window.localStorage.setItem(CONFIG_KEY, behindPayload(beforeCalls()))
    const { result } = renderHook(() => useEditorMode())

    expect(result.current.stale).toBe(true)
    expect(result.current.untracked).toBe(false)
    const panel = result.current.drift?.panels.find(p => p.panel === callPanel())
    expect(panel?.changes[0]).toBe('became a phone call')
  })

  // The whole point of a per-panel take: the author gets the toggle back and keeps the
  // afternoon's work, which is what neither Save nor Reset offered.
  it('takes that panel without touching the author’s own', () => {
    const authored = setPanelLabel(beforeCalls(), 0, 'Cover by the author')
    window.localStorage.setItem(CONFIG_KEY, behindPayload(authored))
    const { result } = renderHook(() => useEditorMode())
    const panel = callPanel()

    act(() => result.current.adoptFromFile(panel))

    expect(result.current.config.callScenes.some(s => s.panel === panel)).toBe(true)
    expect(result.current.config.panels[0].label).toBe('Cover by the author')
    expect(result.current.drift?.panels.map(p => p.panel)).not.toContain(panel)
    // Persisted, so the tab that reloads does not have to be told twice.
    const raw = window.localStorage.getItem(CONFIG_KEY)
    expect(JSON.parse(raw ?? '{}').callScenes.some((s: { panel: number }) => s.panel === panel))
      .toBe(true)
  })

  it('keeps warning about what a panel does not cover', () => {
    // A file that has since gained a panel: the list is not a panel and cannot be taken as
    // one, so adopting the call panel must not clear the warning.
    const older = { ...beforeCalls(), panels: beforeCalls().panels.slice(0, -1) }
    window.localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ ...beforeCalls(), seedStamp: configStamp(older), seedBase: older }),
    )
    const { result } = renderHook(() => useEditorMode())
    expect(result.current.drift?.page).toContain('1 panel added to the page')

    act(() => result.current.adoptFromFile(callPanel()))

    expect(result.current.stale).toBe(true)
    expect(result.current.drift?.page).toContain('1 panel added to the page')
  })

  it('clears the selection, since the entry an index named has moved', () => {
    window.localStorage.setItem(CONFIG_KEY, behindPayload(beforeCalls()))
    const { result } = renderHook(() => useEditorMode())

    act(() => result.current.select('img', 0))
    act(() => result.current.adoptFromFile(callPanel()))

    expect(result.current.selected).toBeNull()
  })

  it('reports a payload written before bases existed as untracked, and diffs nothing', () => {
    window.localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ ...beforeCalls(), seedStamp: configStamp(beforeCalls()) }),
    )
    const { result } = renderHook(() => useEditorMode())

    expect(result.current.untracked).toBe(true)
    expect(result.current.drift).toBeNull()
    // The stamp still answers the older question, so the tab is not left unwarned.
    expect(result.current.stale).toBe(true)
  })

  // An edit is not a reconciliation: the author dragging a balloon has not looked at the
  // file, so the base — and everything read off it — has to survive one.
  it('keeps the base, and the report, through an edit', () => {
    window.localStorage.setItem(CONFIG_KEY, behindPayload(beforeCalls()))
    const { result } = renderHook(() => useEditorMode())

    act(() => result.current.setPanelLabel(0, 'Cover'))

    expect(result.current.stale).toBe(true)
    expect(result.current.drift?.panels.map(p => p.panel)).toContain(callPanel())
    const stored = storedBase(window.localStorage.getItem(CONFIG_KEY))
    expect(configStamp(stored as EditorConfig)).toBe(configStamp(beforeCalls()))
  })

  it('starts tracking a fresh session, and stays quiet about it', () => {
    const { result } = renderHook(() => useEditorMode())
    expect(result.current.untracked).toBe(false)
    expect(result.current.stale).toBe(false)

    act(() => result.current.setPanelLabel(0, 'Cover'))

    const raw = window.localStorage.getItem(CONFIG_KEY)
    expect(storedStamp(raw)).toBe(seedStamp())
    expect(configStamp(storedBase(raw) as EditorConfig)).toBe(seedStamp())
  })

  // Reset is the other half of the deal: the copy becomes the file, so it is not behind it
  // any more and there is nothing left to take.
  it('makes the copy the file again on Reset', () => {
    window.localStorage.setItem(CONFIG_KEY, behindPayload(beforeCalls()))
    const { result } = renderHook(() => useEditorMode())

    act(() => result.current.resetAll())

    expect(result.current.stale).toBe(false)
    expect(result.current.untracked).toBe(false)
    expect(hasDrift(result.current.drift)).toBe(false)
    expect(result.current.config.callScenes.some(s => s.panel === callPanel())).toBe(true)
  })
})

/**
 * The guard the whole file is around: `layoutConfig.ts` still ships a panel that is a phone
 * call, with the three roles the Default/Ringing/Connected switch stands in. Nothing else
 * here would fail if a Save flattened it out of the file again — every other test builds
 * its own call — and that flattening is what has happened three times.
 */
describe('the shipped layout', () => {
  it('still has a phone-call panel with a ringing, a remote and a local part', () => {
    const seed = seedConfig()
    expect(seed.callScenes.length).toBeGreaterThan(0)
    const panel = seed.callScenes[0].panel
    const roles = seed.images.filter(i => i.panel === panel).map(i => i.call)
    expect(roles).toContain('ringing')
    expect(roles).toContain('remote')
    expect(roles).toContain('local')
  })
})
