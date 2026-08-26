import { describe, expect, it } from 'vitest'

import {
  MAX_FRAME_DT,
  frameDelta,
  restClock,
  stepPanelDots,
} from '../../skins/comic-book/panelDotAnim'
import { PANEL_BG_CONFIGS } from '../../skins/comic-book/panelPatterns'

// The clock arithmetic behind "a panel animates only while it is hovered". The
// renderers are exercised in panelPatternMotion.test.ts and the loop that puts the
// two together in usePanelDots.test.ts.

describe('frameDelta', () => {
  it('is zero on the first frame of a loop, which has no previous timestamp', () => {
    expect(frameDelta(null, 1234)).toBe(0)
  })

  it('converts a gap between rAF timestamps to seconds', () => {
    expect(frameDelta(1000, 1016)).toBeCloseTo(0.016, 6)
  })

  it('clamps a long gap so a backgrounded tab resumes rather than leaps', () => {
    // Returning after 30 s must not advance the pattern 30 s in one frame.
    expect(frameDelta(1000, 31_000)).toBe(MAX_FRAME_DT)
  })

  it('never runs backwards on a non-monotonic timestamp', () => {
    expect(frameDelta(2000, 1000)).toBe(0)
  })
})

describe('restClock', () => {
  it('seeds each panel from its shipped phase', () => {
    PANEL_BG_CONFIGS.forEach((cfg, i) => {
      expect(restClock(i)).toBe(cfg.phase)
    })
  })

  it('gives resting panels different frames, not one pose repeated', () => {
    const clocks = PANEL_BG_CONFIGS.map((_, i) => restClock(i))
    expect(new Set(clocks).size).toBeGreaterThan(1)
  })

  it('answers for a panel with no shipped config rather than yielding NaN', () => {
    expect(restClock(PANEL_BG_CONFIGS.length + 5)).toBe(0)
  })
})

describe('stepPanelDots', () => {
  it('advances the clock and repaints while the panel is active', () => {
    expect(stepPanelDots(2, true, 0.016, false)).toEqual({ clock: 2.016, paint: true })
  })

  // The reversion check for the whole feature: were the gate dropped, an inactive
  // panel would both move and repaint here.
  it('holds the clock and skips the repaint while the panel is at rest', () => {
    expect(stepPanelDots(2, false, 0.016, false)).toEqual({ clock: 2, paint: false })
  })

  it('repaints a dirty inactive panel once, without moving its clock', () => {
    // A resized or remounted canvas is blank, so it has to be redrawn — at the
    // frame it froze on, which is what keeps a resize from restarting the motion.
    expect(stepPanelDots(2, false, 0.016, true)).toEqual({ clock: 2, paint: true })
  })

  it('resumes from where it froze rather than from the elapsed wall time', () => {
    let clock = 1
    for (let i = 0; i < 10; i++) clock = stepPanelDots(clock, false, 0.05, false).clock
    expect(stepPanelDots(clock, true, 0.05, false).clock).toBeCloseTo(1.05, 6)
  })
})
