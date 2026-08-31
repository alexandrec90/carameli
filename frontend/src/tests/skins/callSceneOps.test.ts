import { describe, expect, it, vi } from 'vitest'

import { addCallScene } from '../../skins/comic-book/editor/callSceneCreate'
import {
  CALL_CUT,
  callPanels,
  clampCut,
  cloneCallScene,
  DEFAULT_CALL_AXIS,
  DEFAULT_CALL_CUT,
  hydrateCallScenes,
  isCallSceneLayout,
  patchCallSceneIn,
  roleOf,
  syncCallScenes,
} from '../../skins/comic-book/editor/callSceneOps'
import { patchBubble, patchCallScene, patchImg, removeImg } from '../../skins/comic-book/editor/configOps'
import { cloneConfig, seedConfig } from '../../skins/comic-book/editor/configSeed'
import { hydrateConfig } from '../../skins/comic-book/editor/configHydrate'
import { serializeCallScenes } from '../../skins/comic-book/editor/serialize'
import type { CallRole, CallSceneLayout, EditorConfig } from '../../skins/comic-book/editor/types'

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

// The scene list is *derived*, and that is the whole design: a panel is a phone call for
// exactly as long as something on it carries a role. "Add a scene" and "delete a scene"
// are not operations, so a scene with no members and a role with no scene are states the
// editor cannot reach — which is what these tests are holding.

const entry = (panel: number, call?: CallRole) => ({ panel, call })

/** An empty page, so a derivation is read off the entries put on it and nothing else. */
function bare(): EditorConfig {
  const config = cloneConfig(seedConfig())
  config.images = []
  config.bubbles = []
  config.callScenes = []
  return config
}

describe('clampCut', () => {
  it('holds the seam inside the range the inspector offers', () => {
    // A cut at 0 leaves a half with no area — nothing to see and nothing to grab it back by.
    expect(clampCut(0)).toBe(CALL_CUT.min)
    expect(clampCut(100)).toBe(CALL_CUT.max)
    expect(clampCut(37)).toBe(37)
  })

  it('rounds to whole percentages, the step the slider moves in', () => {
    expect(clampCut(42.6)).toBe(43)
  })

  it('centres anything that is not a number at all', () => {
    expect(clampCut(NaN)).toBe(DEFAULT_CALL_CUT)
    expect(clampCut(Infinity)).toBe(DEFAULT_CALL_CUT)
  })
})

describe('isCallSceneLayout', () => {
  const valid: CallSceneLayout = { panel: 3, cut: 50, axis: 'x' }

  it('accepts a whole scene', () => {
    expect(isCallSceneLayout(valid)).toBe(true)
    expect(isCallSceneLayout({ ...valid, axis: 'y' })).toBe(true)
  })

  it('rejects one missing a field, or carrying a bad one', () => {
    expect(isCallSceneLayout(null)).toBe(false)
    expect(isCallSceneLayout({ ...valid, panel: -1 })).toBe(false)
    expect(isCallSceneLayout({ ...valid, panel: 1.5 })).toBe(false)
    expect(isCallSceneLayout({ ...valid, cut: NaN })).toBe(false)
    expect(isCallSceneLayout({ ...valid, axis: 'z' })).toBe(false)
  })
})

describe('cloneCallScene', () => {
  it('copies a scene, clamping the seam and settling the axis on the way', () => {
    expect(cloneCallScene({ panel: 2, cut: 999, axis: 'y' }))
      .toEqual({ panel: 2, cut: CALL_CUT.max, axis: 'y' })
    expect(cloneCallScene({ panel: 2, cut: 50, axis: 'sideways' as never }).axis).toBe('x')
  })

  it('shares nothing with the scene it copied', () => {
    const original: CallSceneLayout = { panel: 2, cut: 50, axis: 'x' }
    const copy = cloneCallScene(original)
    copy.cut = 20
    expect(original.cut).toBe(50)
  })
})

describe('roleOf and callPanels', () => {
  it('reads a role only when it is one the skin knows', () => {
    expect(roleOf(entry(0, 'local'))).toBe('local')
    expect(roleOf(entry(0))).toBeUndefined()
    expect(roleOf(entry(0, 'nonsense' as CallRole))).toBeUndefined()
  })

  it('names the panels a call is on, from either array, once each and in order', () => {
    const panels = callPanels(
      [entry(9, 'ringing'), entry(9, 'local'), entry(3)],
      [entry(2, 'local'), entry(9, 'remote')],
    )
    expect(panels).toEqual([2, 9])
  })

  it('names none when nothing carries a role', () => {
    expect(callPanels([entry(0), entry(1)], [entry(0)])).toEqual([])
  })
})

describe('syncCallScenes', () => {
  it('makes a centred scene for a panel that has just become a call', () => {
    expect(syncCallScenes([entry(4, 'ringing')], [], []))
      .toEqual([{ panel: 4, cut: DEFAULT_CALL_CUT, axis: DEFAULT_CALL_AXIS }])
  })

  it('keeps the seam an existing scene already carried', () => {
    // The derivation must not undo the author's framing every time they touch an entry —
    // which is every drag, so a re-centre here would make the seam impossible to move.
    const scenes: CallSceneLayout[] = [{ panel: 4, cut: 25, axis: 'y' }]
    expect(syncCallScenes([entry(4, 'ringing')], [], scenes)).toEqual(scenes)
  })

  it('drops a scene once nothing on its panel carries a role any more', () => {
    // The other unreachable state: two empty halves drawn over the panel's real contents,
    // with a seam still offered in the inspector for a call nobody can see.
    const scenes: CallSceneLayout[] = [{ panel: 4, cut: 25, axis: 'x' }]
    expect(syncCallScenes([entry(4)], [], scenes)).toEqual([])
  })

  it('keeps a panel a call while a balloon alone still names it', () => {
    const scenes: CallSceneLayout[] = [{ panel: 4, cut: 25, axis: 'x' }]
    expect(syncCallScenes([], [entry(4, 'local')], scenes)).toEqual(scenes)
  })
})

describe('patchCallSceneIn', () => {
  const scenes: CallSceneLayout[] = [
    { panel: 2, cut: 50, axis: 'x' },
    { panel: 9, cut: 50, axis: 'x' },
  ]

  it('moves one seam and leaves the other alone', () => {
    const next = patchCallSceneIn(scenes, 9, { cut: 30, axis: 'y' })
    expect(next[1]).toEqual({ panel: 9, cut: 30, axis: 'y' })
    expect(next[0]).toEqual(scenes[0])
  })

  it('clamps a seam dragged past the end', () => {
    expect(patchCallSceneIn(scenes, 9, { cut: 300 })[1].cut).toBe(CALL_CUT.max)
  })

  it('refuses to move a scene to another panel', () => {
    // `panel` is the join key, not a setting: changing it here would strand every entry
    // pointing at this one. The move that works is on the entry's own panel field.
    expect(patchCallSceneIn(scenes, 9, { panel: 1 } as Partial<CallSceneLayout>)[1].panel).toBe(9)
  })

  it('inserts nothing for a panel with no scene', () => {
    // The list is the entries' to grow. A seam on a panel drawing no call has nothing to
    // move, and inserting one here would make a scene with no members.
    expect(patchCallSceneIn(scenes, 5, { cut: 30 })).toEqual(scenes)
  })
})

describe('hydrateCallScenes', () => {
  it('reads a stored list back, clamped', () => {
    expect(hydrateCallScenes([{ panel: 1, cut: 0, axis: 'y' }]))
      .toEqual([{ panel: 1, cut: CALL_CUT.min, axis: 'y' }])
  })

  it('drops entries that are not scenes, and repeats of a panel', () => {
    const raw = [
      { panel: 1, cut: 50, axis: 'x' },
      'nonsense',
      { panel: 1, cut: 20, axis: 'y' },
    ]
    expect(hydrateCallScenes(raw)).toEqual([{ panel: 1, cut: 50, axis: 'x' }])
  })

  it('reads a payload written before call scenes existed as no scenes', () => {
    // Which `syncCallScenes` then rebuilds from the entries, so such a payload loses only
    // the seams it never carried.
    expect(hydrateCallScenes(undefined)).toEqual([])
    expect(hydrateCallScenes({})).toEqual([])
  })
})

describe('a call role through the whole config', () => {
  it('drops a role the skin has retired, leaving the entry in the ordinary layout', () => {
    // Absence is exactly the state that says "part of this panel's ordinary layout", so a
    // role the skin no longer knows belongs there rather than in a call it would be
    // invisible in.
    const config = bare()
    config.images.push({ ...seedConfig().images[0], panel: 0, call: 'ghost' as CallRole })
    const image = hydrateConfig(JSON.stringify(config)).images[0]
    expect('call' in image).toBe(false)
  })

  it('keeps a role the skin knows, and derives the scene from it', () => {
    const config = bare()
    config.images.push({ ...seedConfig().images[0], panel: 0, call: 'local' })
    const hydrated = hydrateConfig(JSON.stringify(config))
    expect(hydrated.images[0].call).toBe('local')
    expect(hydrated.callScenes).toEqual([
      { panel: 0, cut: DEFAULT_CALL_CUT, axis: DEFAULT_CALL_AXIS },
    ])
  })

  it('writes an empty block when no panel is a call, and the seams when one is', () => {
    // `[]` on one line is the shipped state rather than the trace of something deleted.
    expect(serializeCallScenes([])).toContain('PANEL_CALL_SCENES: CallSceneLayout[] = []')
    expect(serializeCallScenes([{ panel: 9, cut: 25.4, axis: 'y' }]))
      .toContain("{ panel: 9, cut: 25, axis: 'y' },")
  })
})

describe('addCallScene', () => {
  it('makes the six entries a call is, and the seam they are framed against', () => {
    const { config, index } = addCallScene(bare(), 4)

    expect(config.images.map(i => i.call)).toEqual(['ringing', 'remote', 'local'])
    expect(config.bubbles.map(b => b.call)).toEqual(['remote', 'local', 'local'])
    expect(config.images.every(i => i.panel === 4)).toBe(true)
    expect(config.bubbles.every(b => b.panel === 4)).toBe(true)
    // Derived with them, not set here — a second place for the same fact is the one that
    // can disagree.
    expect(config.callScenes).toEqual([
      { panel: 4, cut: DEFAULT_CALL_CUT, axis: DEFAULT_CALL_AXIS },
    ])
    // The first figure, because a call is added to look at it and the picture is what the
    // author drags first.
    expect(index).toBe(0)
    expect(config.images[index].call).toBe('ringing')
  })

  it('gives the call one key to hang up with, and a transcript for each seat', () => {
    const { config } = addCallScene(bare(), 4)
    const contents = config.bubbles.map(b => b.content)
    expect(contents.filter(c => c === 'transcript')).toHaveLength(2)
    expect(contents.filter(c => c === 'actions')).toHaveLength(1)
  })

  it('leaves the page it was handed alone', () => {
    const before = bare()
    addCallScene(before, 4)
    expect(before.images).toEqual([])
    expect(before.callScenes).toEqual([])
  })

  it('refuses a second call on the same panel, and points at the first', () => {
    // A panel is cut in two once; a second set of figures would stack invisibly on the
    // first. Handing back the picture already there shows the author what they asked for
    // rather than nothing happening.
    const { config: once } = addCallScene(bare(), 4)
    const { config: twice, index } = addCallScene(once, 4)
    expect(twice).toBe(once)
    expect(twice.images).toHaveLength(3)
    expect(index).toBe(0)
  })

  it('lets another panel be a call of its own', () => {
    const { config: one } = addCallScene(bare(), 4)
    const { config: two } = addCallScene(one, 7)
    expect(two.callScenes.map(s => s.panel)).toEqual([4, 7])
  })
})

describe('a call layout as the editor edits it', () => {
  it('takes the panel’s call apart as its last role is cleared', () => {
    // Every entry stays an ordinary one — retyped, given another role, deleted — and the scene
    // follows. This is `reconcile` running on picture ops as well as bubble ops: without
    // it a cleared role would leave a seam behind with nothing drawn in either half.
    let config = addCallScene(bare(), 4).config
    config = patchImg(config, 0, { call: undefined })
    config = patchImg(config, 1, { call: undefined })
    config = patchImg(config, 2, { call: undefined })
    expect(config.callScenes).toHaveLength(1) // three balloons still name it

    config = patchBubble(config, 0, { call: undefined })
    config = patchBubble(config, 1, { call: undefined })
    config = patchBubble(config, 2, { call: undefined })
    expect(config.callScenes).toEqual([])
  })

  it('follows a figure the author moved to another panel', () => {
    let config = addCallScene(bare(), 4).config
    config = patchImg(config, 0, { panel: 6 })
    expect(config.callScenes.map(s => s.panel)).toEqual([4, 6])
  })

  it('keeps the seam while entries come and go around it', () => {
    let config = addCallScene(bare(), 4).config
    config = patchCallScene(config, 4, { cut: 30, axis: 'y' })
    config = removeImg(config, 0)
    expect(config.callScenes).toEqual([{ panel: 4, cut: 30, axis: 'y' }])
  })
})
