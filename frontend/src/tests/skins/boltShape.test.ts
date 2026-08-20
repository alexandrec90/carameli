import { describe, expect, it } from 'vitest'

import { BOLT_SPIKES, boltMod } from '../../skins/comic-book/boltShape'
import { BUBBLE_VIEW, ELLIPSE, RING_POINTS, ringTheta } from '../../skins/comic-book/bubbleBox'

/** Radius of every ring vertex, in base-ellipse units: 1 sits exactly on the ellipse. */
const R: number[] = Array.from({ length: RING_POINTS }, (_, i) => boltMod(i))

const at = (i: number): number => R[(i + RING_POINTS) % RING_POINTS]

/** Indices of the cyclic local maxima — the spike tips. */
const CRESTS: number[] = R.map((_, i) => i).filter(i => at(i) > at(i - 1) && at(i) >= at(i + 1))

/** Indices of the cyclic local minima — the notches between them. */
const TROUGHS: number[] = R.map((_, i) => i).filter(i => at(i) < at(i - 1) && at(i) <= at(i + 1))

/** Where ring vertex `i` lands in BUBBLE_VIEW units. */
function point(i: number): [number, number] {
  const theta = ringTheta(i)
  return [
    ELLIPSE.cx + ELLIPSE.rx * R[i] * Math.cos(theta),
    ELLIPSE.cy + ELLIPSE.ry * R[i] * Math.sin(theta),
  ]
}

describe('boltMod', () => {
  // The whole point of the shared ring: a spike table that spent more or fewer than
  // RING_POINTS vertices would leave `lightning` un-morphable against the other types,
  // and the failure would show up as a crash in lerpPoints rather than as a bad shape.
  it('spends exactly the ring on its spikes', () => {
    expect(R).toHaveLength(RING_POINTS)
    R.forEach(v => expect(Number.isFinite(v)).toBe(true))
  })

  // 16–22 is the brief: below it the outline reads as a flower, above it the spikes
  // get too few vertices each to stay triangles at 64 points.
  it('carries between 16 and 22 spikes', () => {
    expect(BOLT_SPIKES).toBeGreaterThanOrEqual(16)
    expect(BOLT_SPIKES).toBeLessThanOrEqual(22)
  })

  // Every authored spike survives as a point on the drawn outline, and every gap
  // between two of them is a real notch. Equal counts is what makes the perimeter
  // strictly alternating rather than a run of bumps on one shoulder.
  it('alternates one crest and one trough per spike', () => {
    expect(CRESTS).toHaveLength(BOLT_SPIKES)
    expect(TROUGHS).toHaveLength(BOLT_SPIKES)
  })

  // A burst, not a sun: the crests are not one length and the notches cut well inside
  // the base ellipse, so the silhouette is sawtooth rather than scalloped.
  it('cuts deep notches between spikes of very different lengths', () => {
    const tips = CRESTS.map(i => R[i])
    const notches = TROUGHS.map(i => R[i])
    expect(Math.max(...tips)).toBeGreaterThan(1.35)
    expect(Math.max(...notches)).toBeLessThan(0.9)
    // Longest tip against deepest notch: the peak-to-valley swing of the outline.
    expect(Math.max(...tips) - Math.min(...notches)).toBeGreaterThan(0.6)
    // Several tips project dramatically; most stay stubs. Neither group is empty.
    expect(tips.filter(v => v > 1.25)).not.toHaveLength(0)
    expect(tips.filter(v => v < 1.05)).not.toHaveLength(0)
  })

  // The user-visible complaint the rewrite answers. A cosine burst climbs a quarter
  // period to its crown; a triangle can do it in one segment, and does.
  it('turns corners in a single segment instead of easing through a curve', () => {
    const step = Math.max(...R.map((v, i) => Math.abs(at(i + 1) - v)))
    expect(step).toBeGreaterThan(0.5)
  })

  // Uniform spacing is the sun look. The spans are irregular by construction, so the
  // distance from one tip to the next takes several different values.
  it('spaces the spikes irregularly', () => {
    const gaps = CRESTS.map(
      (v, i) => (CRESTS[(i + 1) % CRESTS.length] - v + RING_POINTS) % RING_POINTS,
    )
    expect(new Set(gaps).size).toBeGreaterThan(2)
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps) + 1)
  })

  // Jaggedness belongs at the perimeter. If the notches cut to the middle there is no
  // interior left to letter into, which is the failure mode opposite to "too soft".
  it('keeps a large central body for the lettering', () => {
    expect(Math.min(...R)).toBeGreaterThan(0.65)
  })

  // Wider than tall, like the reference. The ellipse is already 84×44, and the spikes
  // must not be so much longer at the top and bottom that they square the outline up.
  it('stays wider than it is tall', () => {
    const xs = R.map((_, i) => point(i)[0])
    const ys = R.map((_, i) => point(i)[1])
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    expect(w / h).toBeGreaterThan(1.4)
  })

  // Structural, not lucky: `boltMod` clamps each vertex against the box at its own
  // angle. The previous burst cleared the edge only because no crown happened to land
  // on the lateral extremes, where the viewBox is tightest.
  it('keeps every vertex inside the viewBox', () => {
    R.forEach((_, i) => {
      const [x, y] = point(i)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(BUBBLE_VIEW.w)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(BUBBLE_VIEW.h)
    })
  })

  // The morph loop resamples the ring every frame, so a Math.random roughness would
  // make the ink crawl. Stable geometry is also what makes everything above assertable.
  it('is deterministic', () => {
    expect(Array.from({ length: RING_POINTS }, (_, i) => boltMod(i))).toEqual(R)
  })
})
