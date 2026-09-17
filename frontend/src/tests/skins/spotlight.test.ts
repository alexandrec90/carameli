import { afterEach, describe, expect, it } from 'vitest'

import {
  createSpotlightTracker,
  easeFraction,
  pageSpotlight,
  SPOT_FADE_MS,
  SPOT_FOLLOW_MS,
  SPOT_OFF,
  SPOT_REACH,
  spotlightAt,
  spotlightFalloff,
  stepSpotlight,
} from '../../skins/comic-book/spotlight'
import type { SpotlightState } from '../../skins/comic-book/spotlight'
import { GRID_SPACING } from '../../skins/comic-book/benDayGrid'

// The spotlight: the pointer as the one light on the Ben-Day grid. The step function
// and the falloff are held here; that the drawing surfaces spend it is
// gridLight.test.ts, and the loop that samples it is skinLoadingGrid.test.tsx.

// A settled light at a point — where the tests below usually start from.
const LIT: SpotlightState = { x: 400, y: 300, presence: 1 }

/** Step until nothing moves, or give up: how many frames the ease takes to arrive. */
function settle(from: SpotlightState, pointer: { x: number; y: number } | null, dtMs = 16) {
  let state = from
  let frames = 0
  for (; frames < 1000; frames += 1) {
    const next = stepSpotlight(state, pointer, dtMs)
    if (next === state) break
    state = next
  }
  return { state, frames }
}

// jsdom and happy-dom have no PointerEvent; the listener only reads clientX/clientY,
// which MouseEvent carries, and 'pointermove' is just the type it subscribes to.
function move(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))
}

function leave() {
  document.documentElement.dispatchEvent(new MouseEvent('mouseleave'))
}

describe('spotlightFalloff', () => {
  it('is full at the centre and out at the reach', () => {
    expect(spotlightFalloff(0)).toBe(1)
    expect(spotlightFalloff(SPOT_REACH)).toBe(0)
    expect(spotlightFalloff(SPOT_REACH * 3)).toBe(0)
  })

  it('falls monotonically from centre to reach', () => {
    let prev = 1
    for (let d = 0; d <= SPOT_REACH; d += 5) {
      const v = spotlightFalloff(d)
      expect(v).toBeLessThanOrEqual(prev)
      expect(v).toBeGreaterThanOrEqual(0)
      prev = v
    }
  })

  it('is a pool many dots wide, not a highlight on one', () => {
    // The effect is a grid swelling under the hand. A reach under a few pitches would
    // light one dot at a time and read as a cursor trail.
    expect(SPOT_REACH).toBeGreaterThan(GRID_SPACING * 6)
  })
})

describe('spotlightAt', () => {
  it('is nothing anywhere while the light is out', () => {
    expect(spotlightAt(SPOT_OFF, 0, 0)).toBe(0)
    expect(spotlightAt({ x: 100, y: 100, presence: 0 }, 100, 100)).toBe(0)
  })

  it('is the falloff at full presence', () => {
    expect(spotlightAt(LIT, 400, 300)).toBe(1)
    expect(spotlightAt(LIT, 400 + 100, 300)).toBeCloseTo(spotlightFalloff(100), 9)
    expect(spotlightAt(LIT, 400, 300 + SPOT_REACH)).toBe(0)
  })

  it('scales with presence, so a fading light dims rather than shrinks', () => {
    const half = { ...LIT, presence: 0.5 }
    expect(spotlightAt(half, 400, 300)).toBeCloseTo(0.5, 9)
    expect(spotlightAt(half, 450, 300)).toBeCloseTo(0.5 * spotlightFalloff(50), 9)
  })
})

describe('easeFraction', () => {
  it('covers none of the way in no time and all of it eventually', () => {
    expect(easeFraction(0, SPOT_FOLLOW_MS)).toBe(0)
    expect(easeFraction(SPOT_FOLLOW_MS * 50, SPOT_FOLLOW_MS)).toBeCloseTo(1, 9)
  })

  it('covers about two thirds in one time constant', () => {
    expect(easeFraction(SPOT_FADE_MS, SPOT_FADE_MS)).toBeCloseTo(1 - 1 / Math.E, 9)
  })
})

describe('stepSpotlight', () => {
  it('returns the very same state when nothing has moved, so a loop can skip the paint', () => {
    expect(stepSpotlight(LIT, { x: 400, y: 300 }, 16)).toBe(LIT)
    expect(stepSpotlight(SPOT_OFF, null, 16)).toBe(SPOT_OFF)
  })

  it('comes on where the pointer is, and fades up rather than snapping', () => {
    const first = stepSpotlight(SPOT_OFF, { x: 50, y: 60 }, 16)
    expect(first.x).toBe(50)
    expect(first.y).toBe(60)
    expect(first.presence).toBeGreaterThan(0)
    expect(first.presence).toBeLessThan(0.1)
    const { state, frames } = settle(SPOT_OFF, { x: 50, y: 60 })
    expect(state).toEqual({ x: 50, y: 60, presence: 1 })
    // A few times the fade constant, in 16 ms frames.
    expect(frames * 16).toBeGreaterThan(SPOT_FADE_MS * 3)
    expect(frames * 16).toBeLessThan(SPOT_FADE_MS * 8)
  })

  it('chases a moved pointer and arrives on it', () => {
    const one = stepSpotlight(LIT, { x: 600, y: 300 }, 16)
    expect(one.x).toBeGreaterThan(400)
    expect(one.x).toBeLessThan(600)
    expect(one.y).toBe(300)
    expect(one.presence).toBe(1)
    const { state, frames } = settle(LIT, { x: 600, y: 500 })
    expect(state).toEqual({ x: 600, y: 500, presence: 1 })
    expect(frames * 16).toBeLessThan(SPOT_FOLLOW_MS * 10)
  })

  it('follows quickly and fades slowly: the chase is far shorter than the fade', () => {
    // A light that lagged the hand by as long as it takes to come up would read as
    // dragging; one that came up as fast as it chases would flash on arrival.
    expect(SPOT_FOLLOW_MS * 3).toBeLessThan(SPOT_FADE_MS)
  })

  it('goes out in place when the pointer leaves, and settles to exactly off', () => {
    const one = stepSpotlight(LIT, null, 16)
    expect(one.x).toBe(400)
    expect(one.y).toBe(300)
    expect(one.presence).toBeLessThan(1)
    const { state } = settle(LIT, null)
    expect(state.presence).toBe(0)
    expect(state.x).toBe(400)
  })

  it('comes back on at the pointer, not gliding from where it went out', () => {
    const out = settle(LIT, null).state
    const back = stepSpotlight(out, { x: 10, y: 20 }, 16)
    expect(back.x).toBe(10)
    expect(back.y).toBe(20)
  })

  it('arrives in one step given enough time — a backgrounded tab does not resume mid-glide', () => {
    expect(stepSpotlight(LIT, { x: 900, y: 900 }, 60_000)).toEqual({ x: 900, y: 900, presence: 1 })
    expect(stepSpotlight(LIT, null, 60_000).presence).toBe(0)
  })

  it('advances nothing in no time', () => {
    const next = stepSpotlight(LIT, { x: 900, y: 900 }, 0)
    expect(next).toEqual(LIT)
  })
})

describe('createSpotlightTracker', () => {
  const rest = () => ({ x: 500, y: 250 })
  let releases: Array<() => void> = []
  afterEach(() => {
    for (const r of releases) r()
    releases = []
  })

  it('rests at the given point until the pointer has spoken', () => {
    const tracker = createSpotlightTracker(rest)
    releases.push(tracker.acquire())
    const first = tracker.sample(1000)
    expect(first.x).toBe(500)
    expect(first.y).toBe(250)
    // Comes up over the following frames, at rest.
    const later = tracker.sample(1000 + SPOT_FADE_MS * 10)
    expect(later).toEqual({ x: 500, y: 250, presence: 1 })
  })

  it('stays out where there is no rest point', () => {
    const tracker = createSpotlightTracker(() => null)
    releases.push(tracker.acquire())
    tracker.sample(0)
    expect(tracker.sample(5000)).toBe(SPOT_OFF)
  })

  it('goes to the pointer on a move and out on a leave', () => {
    const tracker = createSpotlightTracker(rest)
    releases.push(tracker.acquire())
    tracker.sample(0)
    tracker.sample(5000)
    move(80, 90)
    expect(tracker.sample(10_000)).toEqual({ x: 80, y: 90, presence: 1 })
    leave()
    const out = tracker.sample(20_000)
    expect(out.presence).toBe(0)
    expect(out.x).toBe(80)
  })

  it('answers the same instant with the same state, and an earlier one without stepping', () => {
    const tracker = createSpotlightTracker(rest)
    releases.push(tracker.acquire())
    tracker.sample(0)
    move(80, 90)
    const at = tracker.sample(100)
    expect(tracker.sample(100)).toBe(at)
    expect(tracker.sample(50)).toBe(at)
    expect(tracker.sample(101)).not.toBe(at)
  })

  it('hears the pointer only while someone holds it', () => {
    const tracker = createSpotlightTracker(rest)
    move(80, 90)
    releases.push(tracker.acquire())
    tracker.sample(0)
    // The move before the acquire was not heard: still at rest.
    expect(tracker.sample(5000).x).toBe(500)
    move(80, 90)
    expect(tracker.sample(10_000).x).toBe(80)
  })

  it('keeps listening until the last holder lets go, then goes back to rest', () => {
    const tracker = createSpotlightTracker(rest)
    const a = tracker.acquire()
    const b = tracker.acquire()
    tracker.sample(0)
    move(80, 90)
    a()
    a() // idempotent: a second call from the same holder is not b's
    expect(tracker.sample(5000).x).toBe(80)
    b()
    // Back at rest: the old position, clock and pointer are gone.
    releases.push(tracker.acquire())
    const fresh = tracker.sample(1)
    expect(fresh.x).toBe(500)
    expect(fresh.presence).toBe(0)
  })

  it('shares one tracker for the page, resting at the viewport centre', () => {
    expect(pageSpotlight()).toBe(pageSpotlight())
    const tracker = pageSpotlight()
    releases.push(tracker.acquire())
    const first = tracker.sample(0)
    expect(first.x).toBe(window.innerWidth / 2)
    expect(first.y).toBe(window.innerHeight / 2)
  })
})
