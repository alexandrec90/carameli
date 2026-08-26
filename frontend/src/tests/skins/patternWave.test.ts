import { describe, expect, it } from 'vitest'

import {
  SPIN_RATE,
  SWEEP_RATE,
  WAVE_RATE,
  travellingWave,
} from '../../skins/comic-book/patternWave'

// The one motion term every pattern style is built from. It is worth its own tests
// because a sign slip here reverses which way *every* background travels, and the
// draw tests compare whole frames — they would fail without saying why.

describe('travellingWave', () => {
  it('stays inside 0..1 whatever it is handed', () => {
    for (let pos = -500; pos <= 500; pos += 7) {
      const v = travellingWave(pos, 40, pos / 3, WAVE_RATE)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('repeats every `period` px at a fixed time', () => {
    const period = 48
    expect(travellingWave(10 + period, period, 2, WAVE_RATE))
      .toBeCloseTo(travellingWave(10, period, 2, WAVE_RATE), 10)
  })

  it('travels outward, away from where it is measured from', () => {
    // The crest has to move *away* from the focal point: rings that ran inward
    // would read as a drain rather than a pulse, and the sign of the `t` term is
    // the only thing deciding which. Both samples stay inside one period, so the
    // comparison is not confounded by the next crest wrapping into view.
    const period = 40, rate = WAVE_RATE
    const crestPos = (t: number) => {
      let best = 0, bestV = -1
      for (let pos = 0; pos < period; pos += 0.01) {
        const v = travellingWave(pos, period, t, rate)
        if (v > bestV) { bestV = v; best = pos }
      }
      return best
    }
    expect(crestPos(0.5)).toBeGreaterThan(crestPos(0))
  })

  it('holds still at rate 0', () => {
    expect(travellingWave(17, 40, 99, 0)).toBeCloseTo(travellingWave(17, 40, 0, 0), 10)
  })
})

describe('motion rates', () => {
  it('sweeps across a panel slower than it rings outward from a point', () => {
    // A straight sweep spends all its motion going one way; an expanding ring
    // spreads it over every direction. Matching the two numbers is what made
    // diagonal stripes read as too fast next to concentric rings.
    expect(SWEEP_RATE).toBeLessThan(WAVE_RATE)
  })

  it('turns a ray fan far slower than either wave travels', () => {
    // A fan sweeps the whole panel at once, so it is the one motion that has to be
    // near-imperceptible frame to frame — minutes per revolution, not seconds.
    expect(SPIN_RATE).toBeLessThan(SWEEP_RATE / 10)
  })
})
