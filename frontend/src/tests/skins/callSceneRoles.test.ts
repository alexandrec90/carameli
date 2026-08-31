import { describe, expect, it } from 'vitest'

import {
  CALL_ROLE_LABELS,
  CALL_ROLES,
  CALL_TRANSCRIPT_LABELS,
  callSceneOn,
  callSide,
  callSpeaker,
  halfFor,
  inRoles,
  isCallRole,
  litRoles,
  rolesAtPhase,
  rolesOnSide,
} from '../../skins/comic-book/callSceneRoles'
import type { SceneHalves } from '../../skins/comic-book/callSceneGeometry'
import type { CallSceneLayout } from '../../skins/comic-book/editor/types'

// What a `call` role means. This module is the layout switch: presence of a role puts an
// entry in the call layout, absence keeps it in the panel's ordinary one, and which role
// it is decides the half, the moment and the voice. Every other file asks it rather than
// deciding for itself, so a wrong answer here is wrong on the drawing *and* on the click
// targets at once — which is exactly the disagreement it exists to prevent.

const HALVES = {
  a: { pts: [], box: { x: 0, y: 0, w: 50, h: 100 } },
  b: { pts: [], box: { x: 50, y: 0, w: 50, h: 100 } },
  at: 50,
  axis: 'x',
} as unknown as SceneHalves

describe('isCallRole', () => {
  it('accepts the four roles and nothing else', () => {
    expect(CALL_ROLES.every(isCallRole)).toBe(true)
    for (const value of ['', 'caller', 'REMOTE', null, undefined, 3, {}]) {
      expect(isCallRole(value)).toBe(false)
    }
  })

  it('gives every role a label the inspector can offer', () => {
    expect(Object.keys(CALL_ROLE_LABELS).sort()).toEqual([...CALL_ROLES].sort())
    expect(CALL_ROLES.every(role => CALL_ROLE_LABELS[role].length > 0)).toBe(true)
  })
})

describe('callSide', () => {
  it('puts the far end’s two roles in one half, the caller in the other', () => {
    // The reason they share: an author who framed the ringing telephone has framed the
    // person who answers it. Split them and the pickup would jump the picture across the
    // panel, and a second box would need framing to stop it.
    expect(callSide('ringing')).toBe('a')
    expect(callSide('remote')).toBe('a')
    expect(callSide('local')).toBe('b')
  })

  it('leaves a scene role on the panel itself', () => {
    expect(callSide('scene')).toBe('panel')
  })
})

describe('rolesOnSide', () => {
  it('swaps the far end from ringing to answered at the pickup', () => {
    expect(rolesOnSide('a', 'ringing')).toEqual(['ringing'])
    expect(rolesOnSide('a', 'connected')).toEqual(['remote'])
  })

  it('keeps the caller and the panel through both phases', () => {
    expect(rolesOnSide('b', 'ringing')).toEqual(['local'])
    expect(rolesOnSide('b', 'connected')).toEqual(['local'])
    expect(rolesOnSide('panel', 'ringing')).toEqual(['scene'])
  })

  it('never draws two roles in one half at one moment', () => {
    // A half holds one picture at a time; two would stack, and the top one would look
    // like the layout while the other answered the pointer.
    for (const phase of ['ringing', 'connected'] as const) {
      for (const side of ['a', 'b', 'panel'] as const) {
        expect(rolesOnSide(side, phase)).toHaveLength(1)
      }
    }
  })
})

describe('rolesAtPhase', () => {
  it('draws the ringing telephone, the caller and the panel before the pickup', () => {
    expect(rolesAtPhase('ringing')).toEqual(['ringing', 'local', 'scene'])
  })

  it('draws the answered far end in the ringing one’s place afterwards', () => {
    expect(rolesAtPhase('connected')).toEqual(['remote', 'local', 'scene'])
  })

  it('leaves no role off screen in both phases', () => {
    const seen = new Set([...rolesAtPhase('ringing'), ...rolesAtPhase('connected')])
    expect([...seen].sort()).toEqual([...CALL_ROLES].sort())
  })
})

describe('inRoles', () => {
  it('draws only what has no role at all when there is no call up', () => {
    // `null` is the ordinary layout, and it is the half of the switch that hides the call:
    // without it a panel would draw its call figures over its own contents while idle.
    expect(inRoles(undefined, null)).toBe(true)
    expect(inRoles('local', null)).toBe(false)
  })

  it('draws only the roles on screen once one is', () => {
    const roles = rolesAtPhase('ringing')
    expect(inRoles('ringing', roles)).toBe(true)
    expect(inRoles('local', roles)).toBe(true)
    // The other face of the same person: framed, but not this moment's.
    expect(inRoles('remote', roles)).toBe(false)
    // And the panel's own contents step aside for the layout that replaced them.
    expect(inRoles(undefined, roles)).toBe(false)
  })
})

describe('halfFor', () => {
  it('measures each side’s entries against its own half', () => {
    expect(halfFor('ringing', HALVES)).toBe(HALVES.a)
    expect(halfFor('remote', HALVES)).toBe(HALVES.a)
    expect(halfFor('local', HALVES)).toBe(HALVES.b)
  })

  it('gives no half to a scene role or to an entry with no role', () => {
    // Null, not a half spanning the panel: "no half" is the case every picture on every
    // other panel is already in, so the renderers keep one code path rather than gaining
    // a slot element that happens to be the panel's exact size.
    expect(halfFor('scene', HALVES)).toBeNull()
    expect(halfFor(undefined, HALVES)).toBeNull()
  })

  it('gives no half when the panel is not split', () => {
    expect(halfFor('local', null)).toBeNull()
  })
})

describe('litRoles', () => {
  it('lights the ringing telephone unconditionally before the pickup', () => {
    // A ring is the only sound there is then, and there is no transcript to read a
    // speaker off — so silence here would leave the whole panel flat while it rings.
    expect(litRoles('ringing', null)).toEqual(['ringing'])
    expect(litRoles('ringing', 'local')).toEqual(['ringing'])
  })

  it('lights whichever seat is talking afterwards', () => {
    expect(litRoles('connected', 'remote')).toEqual(['remote'])
    expect(litRoles('connected', 'local')).toEqual(['local'])
  })

  it('lights neither through a silence', () => {
    expect(litRoles('connected', null)).toEqual([])
  })
})

describe('callSpeaker', () => {
  it('reads the ringing telephone as the far end, so one balloon serves both', () => {
    // A transcript framed against the ringing figure is the same balloon that fills with
    // their words at the pickup. Null here would empty it the moment they spoke.
    expect(callSpeaker('ringing')).toBe('remote')
    expect(callSpeaker('remote')).toBe('remote')
  })

  it('reads the caller as the near seat, and a scene role as no seat', () => {
    expect(callSpeaker('local')).toBe('local')
    expect(callSpeaker('scene')).toBeNull()
  })

  it('names each seat’s transcript for the reader it belongs to', () => {
    expect(CALL_TRANSCRIPT_LABELS.ringing).toBe(CALL_TRANSCRIPT_LABELS.remote)
    expect(CALL_TRANSCRIPT_LABELS.local).not.toBe(CALL_TRANSCRIPT_LABELS.remote)
    // A transcript outside any call is still a window on a conversation, just not on one
    // seat of it — so it takes a name rather than falling back to none.
    expect(CALL_TRANSCRIPT_LABELS.none.length).toBeGreaterThan(0)
  })
})

describe('callSceneOn', () => {
  const scenes: CallSceneLayout[] = [
    { panel: 2, cut: 40, axis: 'x' },
    { panel: 9, cut: 50, axis: 'y' },
  ]

  it('finds the scene on a panel that has one', () => {
    expect(callSceneOn(scenes, 9)).toBe(scenes[1])
  })

  it('says nothing for a panel with no call layout', () => {
    // Which is what keeps the page's one call from being drawn on every panel at once.
    expect(callSceneOn(scenes, 3)).toBeUndefined()
    expect(callSceneOn([], 9)).toBeUndefined()
  })
})
