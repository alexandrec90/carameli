import { describe, expect, it, vi } from 'vitest'

import type { UseSoftphoneResult } from '../../hooks/useSoftphone'
import { EMPTY_TRANSCRIPT } from '../../lib/callTranscript'
import type { CallTranscript } from '../../lib/callTranscript'
import {
  CALL_SCENE_ALT,
  CALL_SCENE_ART,
  EDITOR_CALL_TRANSCRIPT,
} from '../../skins/comic-book/callScene'
import {
  boundsOf,
  clipAtX,
  clipAtY,
  halfSlot,
  splitAt,
} from '../../skins/comic-book/callSceneGeometry'
import { HALF_GUTTER } from '../../skins/comic-book/panelGeometry'
import type { VpPt } from '../../skins/comic-book/panelGeometry'
import { callSceneOf, HANGUP_KEY, phoneAction } from '../../skins/comic-book/phoneActions'

const phoneStub = (over: Partial<UseSoftphoneResult> = {}): UseSoftphoneResult => ({
  extensions: [],
  selectedId: '',
  select: vi.fn(),
  status: 'registered',
  callStatus: 'idle',
  remoteParty: '',
  registeredAs: '101',
  dialTarget: '',
  setDialTarget: vi.fn(),
  muted: false,
  error: '',
  busy: false,
  connect: vi.fn(async () => {}),
  rotateCredential: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  dial: vi.fn(async () => {}),
  autoDial: vi.fn(async () => {}),
  answer: vi.fn(async () => {}),
  decline: vi.fn(async () => {}),
  hangup: vi.fn(async () => {}),
  toggleMute: vi.fn(),
  pressDigit: vi.fn(),
  transcript: EMPTY_TRANSCRIPT,
  ...over,
})

describe('callSceneOf', () => {
  it('draws nothing while the line is quiet, or ringing in', () => {
    expect(callSceneOf(phoneStub())).toBeNull()
    expect(callSceneOf(phoneStub({ callStatus: 'ringing' }))).toBeNull()
  })

  it('rings while an outbound call is being set up', () => {
    const scene = callSceneOf(phoneStub({ callStatus: 'dialing' }))
    expect(scene?.phase).toBe('ringing')
    expect(scene?.transcript).toBe(EMPTY_TRANSCRIPT)
  })

  it('connects once the call is up, carrying the phone transcript through', () => {
    const transcript: CallTranscript = {
      lines: [{ id: '1', speaker: 'remote', text: 'Hello?' }],
      speaking: 'remote',
    }
    const scene = callSceneOf(phoneStub({ callStatus: 'active', transcript }))
    expect(scene?.phase).toBe('connected')
    expect(scene?.transcript).toBe(transcript)
  })

  // The scene used to carry an `onEnd`, because it drew the red key itself. It does not
  // any more: the key is an ordinary `actions` balloon lettered `End call`, wired through
  // softphoneActions like every other one. Two ways to hang up were two things to keep in
  // step with the telephone's state, and this is the assertion that stops one coming back.
  it('carries the phase and the words, and no handler of its own', () => {
    const scene = callSceneOf(phoneStub({ callStatus: 'active' }))
    expect(Object.keys(scene ?? {}).sort()).toEqual(['phase', 'transcript'])
  })
})

describe('the scene art', () => {
  it('is the red key the actions balloon draws, so the scene and the handset agree', () => {
    expect(phoneAction('End call')).toBe(HANGUP_KEY)
    expect(HANGUP_KEY.src).toBe('/comic-book/end-call-button.webp')
  })

  it('letters an editor transcript from both seats, so either half can be framed', () => {
    const speakers = new Set(EDITOR_CALL_TRANSCRIPT.lines.map(l => l.speaker))
    expect([...speakers].sort()).toEqual(['local', 'remote'])
    expect(EDITOR_CALL_TRANSCRIPT.lines.every(l => l.text.length > 0)).toBe(true)
    // Ids are what the log keys its rows by; a repeat would drop a line from the render.
    const ids = EDITOR_CALL_TRANSCRIPT.lines.map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps anything that reads as real data out of the sample words', () => {
    // This string ships in the production bundle. Sample data shaped like a customer's
    // number or name is how a placeholder gets quoted back as fact — see the same rule
    // about a chain's `data` in .claude/rules/skin-comic-book-framing.md.
    for (const line of EDITOR_CALL_TRANSCRIPT.lines) {
      expect(line.text).not.toMatch(/\d{3}/)
      expect(line.text).not.toMatch(/@/)
    }
  })

  it('names three served pictures, each with a description', () => {
    expect(Object.keys(CALL_SCENE_ART).sort()).toEqual(['local', 'remote', 'ringing'])
    for (const figure of Object.keys(CALL_SCENE_ART) as (keyof typeof CALL_SCENE_ART)[]) {
      expect(CALL_SCENE_ART[figure]).toMatch(/^\/comic-book\/[a-z-]+\.webp$/)
      expect(CALL_SCENE_ALT[figure]).not.toBe('')
    }
  })
})

// A slanted panel: a trapezoid, wider at the bottom.
const TRAPEZOID: VpPt[] = [[20, 0], [80, 0], [100, 60], [0, 60]]

describe('clipAtX', () => {
  it('keeps the side asked for and cuts the crossing edges on the line', () => {
    const left = clipAtX(TRAPEZOID, 50, 'left')
    expect(left).toEqual([[20, 0], [50, 0], [50, 60], [0, 60]])
    const right = clipAtX(TRAPEZOID, 50, 'right')
    expect(right).toEqual([[50, 0], [80, 0], [100, 60], [50, 60]])
  })

  it('interpolates along a slanted edge', () => {
    // The right edge runs (80,0)→(100,60); at x=90 it is halfway down.
    const left = clipAtX(TRAPEZOID, 90, 'left')
    expect(left).toContainEqual([90, 30])
    expect(left).not.toContainEqual([100, 60])
  })

  it('returns nothing from a line past the polygon on the far side', () => {
    expect(clipAtX(TRAPEZOID, 200, 'right')).toEqual([])
    expect(clipAtX(TRAPEZOID, -10, 'left')).toEqual([])
  })
})

describe('clipAtY', () => {
  it('keeps the side asked for and cuts the crossing edges on the line', () => {
    // The trapezoid's slanted sides run (20,0)→(0,60) and (80,0)→(100,60); at y=30 each
    // is halfway along, so the top half closes at x=10 and x=90.
    const top = clipAtY(TRAPEZOID, 30, 'top')
    expect(top).toEqual([[20, 0], [80, 0], [90, 30], [10, 30]])
    const bottom = clipAtY(TRAPEZOID, 30, 'bottom')
    expect(bottom).toEqual([[90, 30], [100, 60], [0, 60], [10, 30]])
  })

  it('returns nothing from a line past the polygon on the far side', () => {
    expect(clipAtY(TRAPEZOID, 200, 'bottom')).toEqual([])
    expect(clipAtY(TRAPEZOID, -10, 'top')).toEqual([])
  })
})

describe('boundsOf', () => {
  it('boxes a polygon and gives an empty one a zero box', () => {
    expect(boundsOf(TRAPEZOID)).toEqual({ x: 0, y: 0, w: 100, h: 60 })
    expect(boundsOf([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('splitAt', () => {
  const bounds = { x: 0, y: 0, w: 100, h: 60 }

  it('cuts down the middle of the box on a 50% x seam, a gutter apart', () => {
    const { a, b, at, axis } = splitAt(TRAPEZOID, bounds, 50, 'x')
    expect(at).toBe(50)
    expect(axis).toBe('x')
    expect(a.box).toEqual({ x: 0, y: 0, w: 50 - HALF_GUTTER, h: 60 })
    expect(b.box).toEqual({ x: 50 + HALF_GUTTER, y: 0, w: 50 - HALF_GUTTER, h: 60 })
    expect(b.box.x - (a.box.x + a.box.w)).toBe(2 * HALF_GUTTER)
  })

  it('puts the seam where the author moved it, as a % of the box', () => {
    // The whole point of the cut being authored: 25% is a quarter across, not the middle.
    const { a, b, at } = splitAt(TRAPEZOID, bounds, 25, 'x')
    expect(at).toBe(25)
    expect(a.box.w).toBe(25 - HALF_GUTTER)
    expect(b.box.x).toBe(25 + HALF_GUTTER)
  })

  it('cuts the other way on a y seam — one half above the other', () => {
    const { a, b, at, axis } = splitAt(TRAPEZOID, bounds, 50, 'y')
    expect(at).toBe(30)
    expect(axis).toBe('y')
    expect(a.box.y).toBe(0)
    expect(a.box.h).toBe(30 - HALF_GUTTER)
    expect(b.box.y).toBe(30 + HALF_GUTTER)
    // A slanted panel widens as it falls, so the halves are *not* the same box turned.
    expect(b.box.w).toBeGreaterThan(a.box.w)
  })

  it('follows a panel that is not at the origin', () => {
    const shifted: VpPt[] = TRAPEZOID.map(([x, y]): VpPt => [x + 300, y + 200])
    const { a, b, at } = splitAt(shifted, { x: 300, y: 200, w: 100, h: 60 }, 50, 'x')
    expect(at).toBe(350)
    expect(a.pts.every(([x]: VpPt) => x <= 350 - HALF_GUTTER)).toBe(true)
    expect(b.pts.every(([x]: VpPt) => x >= 350 + HALF_GUTTER)).toBe(true)
    expect(a.box.y).toBe(200)
  })
})

describe('halfSlot', () => {
  it('places a half inside its own panel element, not on the page', () => {
    // The panel element is already at `bounds`, so the slot's offsets are relative to it.
    // Absolute viewport numbers here would put every call figure a panel's width away.
    const bounds = { x: 300, y: 200, w: 100, h: 60 }
    const { b } = splitAt(
      TRAPEZOID.map(([x, y]): VpPt => [x + 300, y + 200]), bounds, 50, 'x',
    )
    expect(halfSlot(b, bounds)).toEqual({
      left: 50 + HALF_GUTTER,
      top: 0,
      width: b.box.w,
      height: b.box.h,
    })
  })
})
