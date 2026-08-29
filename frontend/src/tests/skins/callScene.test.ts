import { describe, expect, it, vi } from 'vitest'

import type { UseSoftphoneResult } from '../../hooks/useSoftphone'
import { EMPTY_TRANSCRIPT } from '../../lib/callTranscript'
import type { CallTranscript } from '../../lib/callTranscript'
import { CALL_SCENE_ALT, CALL_SCENE_ART } from '../../skins/comic-book/callScene'
import { boundsOf, clipAtX, splitAcross } from '../../skins/comic-book/callSceneGeometry'
import { HALF_GUTTER } from '../../skins/comic-book/panelGeometry'
import type { VpPt } from '../../skins/comic-book/panelGeometry'
import { callSceneOf, HANGUP_KEY, handsetOn, phoneAction } from '../../skins/comic-book/phoneActions'

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

const balloon = (panel: number, content: string, text: string, chain = '') => ({
  panel,
  chain,
  content,
  text,
})

describe('handsetOn', () => {
  it('finds the panel whose actions balloon names a telephone key', () => {
    const bubbles = [balloon(3, 'text', 'Call me'), balloon(9, 'actions', 'Call, End call')]
    expect(handsetOn(bubbles, 9)).toBe(true)
    expect(handsetOn(bubbles, 3)).toBe(false)
  })

  it('counts a dial-call balloon as a handset too', () => {
    expect(handsetOn([balloon(2, 'dial-call', '4388762750')], 2)).toBe(true)
  })

  it('ignores an actions balloon whose options letter instead of drawing keys', () => {
    expect(handsetOn([balloon(4, 'actions', 'Yes, No, Maybe')], 4)).toBe(false)
  })

  it('ignores a balloon in a chain: that is a message, not the telephone', () => {
    expect(handsetOn([balloon(9, 'actions', 'Call, End call', 'sms')], 9)).toBe(false)
  })
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

  it('ends the call through the phone', () => {
    const phone = phoneStub({ callStatus: 'active' })
    callSceneOf(phone)?.onEnd()
    expect(phone.hangup).toHaveBeenCalledTimes(1)
  })
})

describe('the scene art', () => {
  it('is the red key the actions balloon draws, so the scene and the handset agree', () => {
    expect(phoneAction('End call')).toBe(HANGUP_KEY)
    expect(HANGUP_KEY.src).toBe('/comic-book/end-call-button.webp')
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

describe('boundsOf', () => {
  it('boxes a polygon and gives an empty one a zero box', () => {
    expect(boundsOf(TRAPEZOID)).toEqual({ x: 0, y: 0, w: 100, h: 60 })
    expect(boundsOf([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('splitAcross', () => {
  it('cuts the panel down the middle of its box, a gutter apart', () => {
    const bounds = { x: 0, y: 0, w: 100, h: 60 }
    const { left, right, cutX } = splitAcross(TRAPEZOID, bounds)
    expect(cutX).toBe(50)
    expect(left.box).toEqual({ x: 0, y: 0, w: 50 - HALF_GUTTER, h: 60 })
    expect(right.box).toEqual({ x: 50 + HALF_GUTTER, y: 0, w: 50 - HALF_GUTTER, h: 60 })
    expect(right.box.x - (left.box.x + left.box.w)).toBe(2 * HALF_GUTTER)
  })

  it('follows a panel that is not at the origin', () => {
    const shifted: VpPt[] = TRAPEZOID.map(([x, y]) => [x + 300, y + 200])
    const { left, right, cutX } = splitAcross(shifted, { x: 300, y: 200, w: 100, h: 60 })
    expect(cutX).toBe(350)
    expect(left.pts.every(([x]) => x <= 350 - HALF_GUTTER)).toBe(true)
    expect(right.pts.every(([x]) => x >= 350 + HALF_GUTTER)).toBe(true)
    expect(left.box.y).toBe(200)
  })
})
