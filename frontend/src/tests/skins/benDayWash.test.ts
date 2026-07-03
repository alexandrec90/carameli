import { describe, expect, it } from 'vitest'

import {
  dotGrowth,
  easeInOutCubic,
  parseCssColor,
  rippleWave,
  washPhaseAt,
  RIPPLE_WAVE_LEN,
  RIPPLE_SPEED,
  WASH_BAND,
  WASH_COVER_MS,
  WASH_HOLD_MS,
  WASH_MERGE_RADIUS,
  WASH_REVEAL_MS,
  WASH_SPACING,
  WASH_TOTAL_MS,
} from '../../skins/comic-book/benDayWash'

describe('parseCssColor', () => {
  it('parses hex colors to RGB triples', () => {
    expect(parseCssColor('#FFE033')).toEqual([255, 224, 51])
    expect(parseCssColor('#111111')).toEqual([17, 17, 17])
    expect(parseCssColor('#FAFAF2')).toEqual([250, 250, 242])
  })
})

describe('easeInOutCubic', () => {
  it('pins the endpoints and midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(1)).toBe(1)
  })

  it('is monotonically non-decreasing', () => {
    let prev = 0
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const v = easeInOutCubic(Math.min(1, p))
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})

describe('washPhaseAt', () => {
  it('starts with nothing covered', () => {
    expect(washPhaseAt(0)).toEqual({ cover: 0, reveal: 0, done: false })
  })

  it('is mid-cover with no reveal during the cover phase', () => {
    const { cover, reveal, done } = washPhaseAt(WASH_COVER_MS / 2)
    expect(cover).toBeGreaterThan(0)
    expect(cover).toBeLessThan(1)
    expect(reveal).toBe(0)
    expect(done).toBe(false)
  })

  it('holds fully covered with no reveal during the hold phase', () => {
    const { cover, reveal, done } = washPhaseAt(WASH_COVER_MS + WASH_HOLD_MS / 2)
    expect(cover).toBe(1)
    expect(reveal).toBe(0)
    expect(done).toBe(false)
  })

  it('reveals after the hold while staying fully covered behind the front', () => {
    const { cover, reveal, done } =
      washPhaseAt(WASH_COVER_MS + WASH_HOLD_MS + WASH_REVEAL_MS / 2)
    expect(cover).toBe(1)
    expect(reveal).toBeGreaterThan(0)
    expect(reveal).toBeLessThan(1)
    expect(done).toBe(false)
  })

  it('is done once the full timeline has elapsed', () => {
    const { cover, reveal, done } = washPhaseAt(WASH_TOTAL_MS)
    expect(cover).toBe(1)
    expect(reveal).toBe(1)
    expect(done).toBe(true)
  })
})

describe('dotGrowth', () => {
  const maxDiag = 1920 + 1080

  it('leaves dots ahead of the cover front at zero', () => {
    expect(dotGrowth(maxDiag, 0.1, 0, maxDiag)).toBe(0)
  })

  it('fully grows dots well behind the cover front', () => {
    expect(dotGrowth(0, 1, 0, maxDiag)).toBe(1)
    expect(dotGrowth(maxDiag, 1, 0, maxDiag)).toBe(1)
  })

  it('grows dots partially inside the wave band', () => {
    const front = 0.5 * (maxDiag + WASH_BAND)
    const growth = dotGrowth(front - WASH_BAND / 2, 0.5, 0, maxDiag)
    expect(growth).toBeGreaterThan(0)
    expect(growth).toBeLessThan(1)
  })

  it('shrinks dots back to zero once the reveal front has passed', () => {
    expect(dotGrowth(0, 1, 1, maxDiag)).toBe(0)
    expect(dotGrowth(maxDiag, 1, 1, maxDiag)).toBe(0)
  })

  it('is monotonically non-increasing along the diagonal during cover', () => {
    let prev = Infinity
    for (let d = 0; d <= maxDiag; d += maxDiag / 20) {
      const v = dotGrowth(d, 0.6, 0, maxDiag)
      expect(v).toBeLessThanOrEqual(prev)
      prev = v
    }
  })

  it('never returns a value outside 0..1', () => {
    for (const cover of [0, 0.3, 1]) {
      for (const reveal of [0, 0.3, 1]) {
        for (const d of [0, maxDiag / 2, maxDiag]) {
          const v = dotGrowth(d, cover, reveal, maxDiag)
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe('rippleWave', () => {
  it('stays within 0..1', () => {
    for (let d = 0; d < 4000; d += 137) {
      const v = rippleWave(d, 1.234)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('repeats with period RIPPLE_WAVE_LEN along the diagonal', () => {
    expect(rippleWave(300 + RIPPLE_WAVE_LEN, 2)).toBeCloseTo(rippleWave(300, 2))
  })

  it('travels one wavelength toward the bottom-right per 1/RIPPLE_SPEED seconds', () => {
    expect(rippleWave(300 + RIPPLE_WAVE_LEN, 1 / RIPPLE_SPEED)).toBeCloseTo(rippleWave(300, 0))
  })
})

describe('wash coverage', () => {
  it('merge radius makes fully grown dots cover the plane', () => {
    // Circles on a square grid of spacing S tile the plane at radius ≥ S·√2/2.
    expect(WASH_MERGE_RADIUS).toBeGreaterThanOrEqual((WASH_SPACING * Math.SQRT2) / 2)
  })
})
