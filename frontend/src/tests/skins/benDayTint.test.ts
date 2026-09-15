import { describe, expect, it } from 'vitest'

import {
  hslToRgb,
  hueTurned,
  parseCssColor,
  rgbToHsl,
  tintField,
  tintSteps,
  TINT_LEN_DIAG,
  TINT_LEN_X,
  TINT_LEN_Y,
  TINT_RATE_DIAG,
  TINT_RATE_X,
  TINT_RATE_Y,
  TINT_STEP_DEG,
  TINT_SWING_DEG,
} from '../../skins/comic-book/benDayTint'
import {
  RIPPLE_SPEED,
  RIPPLE_WAVE_LEN,
  WASH_SPACING,
} from '../../skins/comic-book/benDayWash'

// The lava-lamp tint: the colour drift through the Ben-Day ripple. What the tests below
// hold is that it is a *drift* — slow enough and broad enough to read as a second motion
// through the wave rather than as the wave changing colour — and that it stays inside the
// route's own accent. Where the dots are is benDayWash.test.ts; that the loading sheet and
// the letterbox agree on a dot's colour is marginRipple.test.ts.

/** The six route accents (`.claude/rules/skin-comic-book.md`, Palette). */
const ACCENTS = ['#FFE033', '#0057B8', '#E8003D', '#00A651', '#00AEEF', '#EC008C']

describe('parseCssColor', () => {
  it('parses hex colors to RGB triples', () => {
    expect(parseCssColor('#FFE033')).toEqual([255, 224, 51])
    expect(parseCssColor('#111111')).toEqual([17, 17, 17])
    expect(parseCssColor('#FAFAF2')).toEqual([250, 250, 242])
  })
})

describe('rgbToHsl / hslToRgb', () => {
  it('round-trips every route accent', () => {
    for (const hex of ACCENTS) {
      const [r, g, b] = parseCssColor(hex)
      expect(hslToRgb(...rgbToHsl(r, g, b))).toEqual([r, g, b])
    }
  })

  it('round-trips the primaries and the extremes of lightness', () => {
    for (const rgb of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 0, 0], [255, 255, 255]]) {
      const [r, g, b] = rgb as [number, number, number]
      expect(hslToRgb(...rgbToHsl(r, g, b))).toEqual([r, g, b])
    }
  })

  it('reports a grey as unsaturated rather than dividing by its zero span', () => {
    const [h, s, l] = rgbToHsl(128, 128, 128)
    expect(h).toBe(0)
    expect(s).toBe(0)
    expect(l).toBeCloseTo(128 / 255, 6)
  })

  it('puts each primary on its own sixth of the wheel', () => {
    expect(rgbToHsl(255, 0, 0)[0]).toBeCloseTo(0, 6)
    expect(rgbToHsl(0, 255, 0)[0]).toBeCloseTo(120, 6)
    expect(rgbToHsl(0, 0, 255)[0]).toBeCloseTo(240, 6)
  })

  it('wraps a hue past either end of the wheel instead of clamping it', () => {
    expect(hslToRgb(370, 1, 0.5)).toEqual(hslToRgb(10, 1, 0.5))
    expect(hslToRgb(-20, 1, 0.5)).toEqual(hslToRgb(340, 1, 0.5))
  })
})

describe('hueTurned', () => {
  it('returns the accent itself when the drift is at rest', () => {
    for (const hex of ACCENTS) {
      expect(hueTurned(hex, 0)).toBe(parseCssColor(hex).join(','))
    }
  })

  it('comes back to the accent after a full turn', () => {
    expect(hueTurned('#0057B8', 360)).toBe(hueTurned('#0057B8', 0))
  })

  it('moves the colour at either end of the swing', () => {
    for (const hex of ACCENTS) {
      expect(hueTurned(hex, TINT_SWING_DEG)).not.toBe(hueTurned(hex, 0))
      expect(hueTurned(hex, -TINT_SWING_DEG)).not.toBe(hueTurned(hex, 0))
      expect(hueTurned(hex, TINT_SWING_DEG)).not.toBe(hueTurned(hex, -TINT_SWING_DEG))
    }
  })

  it('keeps the accent\'s saturation and lightness, so the drift is the same paint', () => {
    // Every colour the drift reaches is the route's accent at another angle. A drift that
    // moved lightness too would wash the sheet out at one end of its travel and darken it
    // at the other, which is a different accent rather than a slow change of one.
    for (const hex of ACCENTS) {
      const [, s0, l0] = rgbToHsl(...parseCssColor(hex))
      for (const deg of [-TINT_SWING_DEG, -7, 7, TINT_SWING_DEG]) {
        const turned = hueTurned(hex, deg).split(',').map(Number) as [number, number, number]
        const [, s, l] = rgbToHsl(...turned)
        expect(s).toBeCloseTo(s0, 1)
        expect(l).toBeCloseTo(l0, 1)
      }
    }
  })

  it('leaves a grey accent alone — it has no hue to turn', () => {
    expect(hueTurned('#808080', TINT_SWING_DEG)).toBe(hueTurned('#808080', 0))
  })
})

describe('tintField', () => {
  it('stays within -1..1 over a viewport and a minute of drift', () => {
    for (let t = 0; t < 60; t += 3.7) {
      for (let x = 0; x < 1920; x += 137) {
        for (let y = 0; y < 1080; y += 149) {
          const v = tintField(x, y, t)
          expect(v).toBeGreaterThanOrEqual(-1)
          expect(v).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('varies across the viewport at one instant, so colour sits in blobs', () => {
    const across = [0, 400, 800, 1200, 1600].map(x => tintField(x, 540, 2))
    expect(new Set(across.map(v => v.toFixed(3))).size).toBeGreaterThan(1)
    const down = [0, 250, 500, 750, 1000].map(y => tintField(960, y, 2))
    expect(new Set(down.map(v => v.toFixed(3))).size).toBeGreaterThan(1)
  })

  it('moves over time at a fixed point, so the colour drifts rather than holds', () => {
    const over = [0, 20, 40, 60, 80].map(t => tintField(400, 300, t))
    expect(new Set(over.map(v => v.toFixed(3))).size).toBeGreaterThan(1)
  })

  it('is diffuse: one dot pitch is a few degrees of hue, not a step', () => {
    // The eye must read blobs, not a checkerboard, and the grid is the finest scale the
    // field is ever sampled at. Neighbouring dots may differ by a few degrees of hue —
    // a ramp — but not by a visible step. Today's worst case across a 1920×1080 sheet is
    // 3.4°; the bound fails long before the ripple could dither between two colours.
    for (let x = 0; x < 1920; x += 97) {
      for (let y = 0; y < 1080; y += 89) {
        for (const [dx, dy] of [[WASH_SPACING, 0], [0, WASH_SPACING]]) {
          const step = Math.abs(tintField(x + dx, y + dy, 5) - tintField(x, y, 5))
          expect(step * TINT_SWING_DEG).toBeLessThan(5)
        }
      }
    }
  })

  it('shows no repeat inside a quarter of an hour of watching', () => {
    // The letterbox ripple runs for as long as the page is open, so the colour must not
    // visibly loop. Asserting the three rates are irrational is not available — they are
    // decimals, so *some* common period always exists — so hold the property that
    // matters instead: no period short enough for a viewer to catch. Samples at the
    // clamp are skipped, where two fields that differ can tie at ±1.
    const sample = (t: number) => tintField(700, 500, t)
    for (let period = 5; period <= 900; period += 5) {
      let matched = 0
      let compared = 0
      for (let t = 0; t < 120; t += 11) {
        if (Math.abs(sample(t)) >= 0.9) continue
        compared += 1
        if (Math.abs(sample(t + period) - sample(t)) < 0.02) matched += 1
      }
      expect(compared).toBeGreaterThan(0)
      expect(matched).toBeLessThan(compared)
    }
  })
})

describe('the tint drifts far more slowly and broadly than the ripple it colours', () => {
  // The design property the whole effect rests on, and the one a retune is most likely to
  // break: colour has to read as a second motion *through* the wave. Were a tint rate to
  // approach RIPPLE_SPEED, or a tint wavelength RIPPLE_WAVE_LEN, the dots would change
  // colour as the crest passed and the two would collapse into one motion.

  it('gives every colour cycle a wavelength several times the ripple\'s', () => {
    for (const len of [TINT_LEN_X, TINT_LEN_Y, TINT_LEN_DIAG]) {
      expect(len).toBeGreaterThan(RIPPLE_WAVE_LEN * 3)
    }
  })

  it('gives every colour cycle a rate under a tenth of the ripple\'s', () => {
    for (const rate of [TINT_RATE_X, TINT_RATE_Y, TINT_RATE_DIAG]) {
      expect(rate).toBeGreaterThan(0)
      expect(rate).toBeLessThan(RIPPLE_SPEED / 10)
    }
  })

  it('takes over half a minute to work through one colour cycle', () => {
    for (const rate of [TINT_RATE_X, TINT_RATE_Y, TINT_RATE_DIAG]) {
      expect(1 / rate).toBeGreaterThan(30)
    }
  })
})

describe('tintSteps', () => {
  it('agrees with hueTurned at the step it rounds to', () => {
    const tint = tintSteps('#00AEEF')
    for (const field of [-1, -0.5, 0, 0.25, 1]) {
      const deg = Math.round(field * TINT_SWING_DEG / TINT_STEP_DEG) * TINT_STEP_DEG
      expect(tint(field)).toBe(hueTurned('#00AEEF', deg))
    }
  })

  it('answers a repeated field value identically — the cache changes no colour', () => {
    const tint = tintSteps('#E8003D')
    expect(tint(0.42)).toBe(tint(0.42))
    expect(tint(-0.9)).toBe(tint(-0.9))
  })

  it('is the same answer from a fresh turner, so a per-band cache cannot drift', () => {
    // drawMarginRipple builds one per letterbox band. Two bands must paint one colour.
    for (const field of [-0.8, -0.2, 0.3, 0.95]) {
      expect(tintSteps('#FFE033')(field)).toBe(tintSteps('#FFE033')(field))
    }
  })

  it('reaches both ends of the swing and the accent between them', () => {
    const tint = tintSteps('#0057B8')
    expect(tint(0)).toBe(parseCssColor('#0057B8').join(','))
    expect(tint(1)).toBe(hueTurned('#0057B8', TINT_SWING_DEG))
    expect(tint(-1)).toBe(hueTurned('#0057B8', -TINT_SWING_DEG))
  })

  it('spends no more than the swing\'s worth of distinct colours', () => {
    const tint = tintSteps('#00A651')
    const seen = new Set<string>()
    for (let field = -1; field <= 1; field += 0.001) seen.add(tint(field))
    expect(seen.size).toBeLessThanOrEqual(2 * TINT_SWING_DEG / TINT_STEP_DEG + 1)
  })
})
