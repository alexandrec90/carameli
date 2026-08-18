import { describe, expect, it } from 'vitest'

import {
  BUBBLE_ASPECT,
  BUBBLE_ELLIPSE_N,
  BUBBLE_VIEW,
  CLOUD_PUFFS,
  RING_POINTS,
  easeOutCubic,
  lerpPoints,
  pathD,
  puffOpacity,
  resolveBubbleShape,
  ringPoints,
} from '../../skins/comic-book/bubbleShape'
import { BUBBLE_TYPE_KEYS } from '../../skins/comic-book/editor/bubbleTypes'
import type { BubbleType } from '../../skins/comic-book/editor/bubbleTypes'

/** Split a flat point list into [x, y] pairs. */
function pairs(pts: number[]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < pts.length; i += 2) out.push([pts[i], pts[i + 1]])
  return out
}

/** The path's command letters in order, e.g. ['M', 'L', …, 'Z']. */
function commands(d: string): string[] {
  return d.match(/[A-Za-z]/g) ?? []
}

/** The base ellipse in BUBBLE_VIEW units — the yardstick every radius is read against. */
const BASE = {
  cx: BUBBLE_VIEW.w * BUBBLE_ELLIPSE_N.cx,
  cy: BUBBLE_VIEW.h * BUBBLE_ELLIPSE_N.cy,
  rx: BUBBLE_VIEW.w * BUBBLE_ELLIPSE_N.rx,
  ry: BUBBLE_VIEW.h * BUBBLE_ELLIPSE_N.ry,
} as const

/**
 * Each vertex's radius in units of the base ellipse: 1 sits exactly on it, above 1
 * bulges out, below 1 cuts in. Reading shapes this way makes "meshed" and "spiky"
 * assertable without exporting the private modulation functions.
 */
function radii(type: BubbleType): number[] {
  return pairs(ringPoints(type)).map(([x, y]) =>
    Math.hypot((x - BASE.cx) / BASE.rx, (y - BASE.cy) / BASE.ry),
  )
}

/**
 * The tail vertex is yanked far off the ring (radius ≈ 1.8), so it would read as a
 * spike in any outline analysis. Replace it with the mean of its neighbors, which
 * is where it sits on a tailless type anyway.
 */
function withoutTail(r: number[]): number[] {
  const i = r.indexOf(Math.max(...r))
  if (r[i] < 1.5) return r
  const out = [...r]
  out[i] = (r[(i + r.length - 1) % r.length] + r[(i + 1) % r.length]) / 2
  return out
}

/** Indices of the cyclic local maxima of `r` — one per lobe crown or spike tip. */
function crests(r: number[]): number[] {
  return r
    .map((_, i) => i)
    .filter(i => r[i] > r[(i + r.length - 1) % r.length] && r[i] >= r[(i + 1) % r.length])
}

/** Largest step between adjacent vertices — how abruptly the outline turns. */
function steepestStep(r: number[]): number {
  return Math.max(...r.map((v, i) => Math.abs(r[(i + 1) % r.length] - v)))
}

describe('ringPoints', () => {
  it('emits RING_POINTS vertices for every type', () => {
    BUBBLE_TYPE_KEYS.forEach(type => {
      expect(ringPoints(type)).toHaveLength(RING_POINTS * 2)
    })
  })

  // The morph invariant: a differing vertex count between two types would leave
  // lerpPoints with nothing to interpolate and every morph into that type broken.
  it('gives every type the identical vertex count so any pair can interpolate', () => {
    const lengths = new Set(BUBBLE_TYPE_KEYS.map(t => ringPoints(t).length))
    expect(lengths.size).toBe(1)
  })

  it('produces only finite coordinates', () => {
    BUBBLE_TYPE_KEYS.forEach(type => {
      ringPoints(type).forEach(n => expect(Number.isFinite(n)).toBe(true))
    })
  })

  it('keeps every vertex inside the viewBox, spikes and tail included', () => {
    BUBBLE_TYPE_KEYS.forEach(type => {
      pairs(ringPoints(type)).forEach(([x, y]) => {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(BUBBLE_VIEW.w)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(BUBBLE_VIEW.h)
      })
    })
  })

  it('starts at the top of the ellipse and runs clockwise', () => {
    const [top, next] = pairs(ringPoints('soft'))
    expect(top[0]).toBeCloseTo(BUBBLE_VIEW.w * BUBBLE_ELLIPSE_N.cx, 6)
    expect(top[1]).toBeLessThan(BUBBLE_VIEW.h * BUBBLE_ELLIPSE_N.cy)
    // Clockwise in screen coords: the next vertex is to the right and lower.
    expect(next[0]).toBeGreaterThan(top[0])
    expect(next[1]).toBeGreaterThan(top[1])
  })

  it('puts every soft vertex on the base ellipse except the tail', () => {
    const offEllipse = pairs(ringPoints('soft')).filter(([x, y]) => {
      const r = ((x - BASE.cx) / BASE.rx) ** 2 + ((y - BASE.cy) / BASE.ry) ** 2
      return Math.abs(r - 1) > 1e-6
    })
    expect(offEllipse).toHaveLength(1)
    // …and that one is the tail, hanging below and left of centre.
    expect(offEllipse[0][1]).toBeGreaterThan(BASE.cy + BASE.ry)
    expect(offEllipse[0][0]).toBeLessThan(BASE.cx)
  })

  it('grows a tail for soft and lightning and none for cloud', () => {
    const lowest = (type: BubbleType): number =>
      Math.max(...pairs(ringPoints(type)).map(([, y]) => y))
    expect(lowest('soft')).toBeGreaterThan(BASE.cy + BASE.ry * 1.5)
    expect(lowest('lightning')).toBeGreaterThan(BASE.cy + BASE.ry * 1.5)
    // A thought bubble trails puffs instead, so its ring stops near the ellipse.
    expect(lowest('cloud')).toBeLessThan(BASE.cy + BASE.ry * 1.3)
  })

  // A cloud is a union of overlapping ellipses, so its junctions are *concave* and
  // cut inside the base ellipse. The scalloped balloon this replaced bulged outward
  // only, and that is exactly why it read as soft rather than as a cloud.
  it('meshes the cloud lobes: crowns bulge out, junctions cut back inside', () => {
    const r = radii('cloud')
    expect(Math.max(...r)).toBeGreaterThan(1.1)
    expect(Math.min(...r)).toBeLessThan(0.97)
  })

  it('spaces the cloud crowns evenly, one lobe per eight vertices', () => {
    const found = crests(radii('cloud'))
    expect(found).toHaveLength(8)
    found.forEach(i => expect(i % (RING_POINTS / 8)).toBe(0))
  })

  // Spikes are triangles, so the outline can climb from a valley to a crown in a
  // single segment. A cosine of the same amplitude cannot: it spreads that climb
  // over a quarter period, which is what made the old burst look soft.
  it('turns lightning corners abruptly rather than cresting a cosine', () => {
    const r = withoutTail(radii('lightning'))
    expect(steepestStep(r)).toBeGreaterThan(0.25)
    expect(steepestStep(radii('cloud'))).toBeLessThan(0.1)
  })

  it('gives lightning eight spikes of differing height', () => {
    const r = withoutTail(radii('lightning'))
    const heights = crests(r).map(i => r[i])
    expect(heights).toHaveLength(8)
    // Uneven: the crowns span a visible range rather than all reaching one radius.
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.05)
    expect(new Set(heights.map(h => h.toFixed(2))).size).toBeGreaterThan(3)
    // …and the tail really was masked out, or this would be ≈ 1.8.
    expect(Math.max(...heights)).toBeLessThan(1.3)
  })

  // A sun is the failure mode to avoid: evenly spaced, identical, symmetric rays.
  // Both properties below hold for a sun and must not hold here.
  it('leans lightning spikes unevenly so it cannot read as a sun', () => {
    const r = withoutTail(radii('lightning'))
    const period = RING_POINTS / 8
    // Not periodic: rotating by one spike does not map the outline onto itself.
    const drift = Math.max(...r.map((v, i) => Math.abs(v - r[(i + period) % r.length])))
    expect(drift).toBeGreaterThan(0.05)
    // Not symmetric within a spike: crowns sit at different offsets in their period.
    const offsets = new Set(crests(r).map(i => i % period))
    expect(offsets.size).toBeGreaterThan(1)
  })

  it('is deterministic, jittered lightning included', () => {
    expect(ringPoints('lightning')).toEqual(ringPoints('lightning'))
  })
})

describe('pathD', () => {
  it('emits one M, then L per remaining vertex, then Z', () => {
    const cmds = commands(pathD(ringPoints('soft')))
    expect(cmds[0]).toBe('M')
    expect(cmds[cmds.length - 1]).toBe('Z')
    expect(cmds.filter(c => c === 'M')).toHaveLength(1)
    expect(cmds.filter(c => c === 'L')).toHaveLength(RING_POINTS - 1)
  })

  // Morphing rewrites `d` mid-flight, so the command sequence has to be identical
  // across types — only the numbers may differ.
  it('uses the same command sequence for every type', () => {
    const shapes = BUBBLE_TYPE_KEYS.map(t => commands(pathD(ringPoints(t))).join(''))
    expect(new Set(shapes).size).toBe(1)
  })

  it('rounds coordinates to at most 2 decimals', () => {
    expect(pathD(ringPoints('lightning'))).not.toMatch(/\d\.\d{3,}/)
  })

  it('round-trips an empty point list to a bare close', () => {
    expect(pathD([])).toBe('Z')
  })
})

describe('lerpPoints', () => {
  it('returns the endpoints at t = 0 and t = 1', () => {
    const a = [0, 0, 10, 10]
    const b = [100, 100, 20, 20]
    expect(lerpPoints(a, b, 0)).toEqual(a)
    expect(lerpPoints(a, b, 1)).toEqual(b)
  })

  it('interpolates vertex-wise at the midpoint', () => {
    expect(lerpPoints([0, 0, 10, -10], [100, 50, 20, 10], 0.5)).toEqual([50, 25, 15, 0])
  })

  it('preserves length when morphing between two real shapes', () => {
    const mid = lerpPoints(ringPoints('soft'), ringPoints('lightning'), 0.5)
    expect(mid).toHaveLength(RING_POINTS * 2)
    mid.forEach(n => expect(Number.isFinite(n)).toBe(true))
  })
})

describe('easeOutCubic', () => {
  it('pins both ends', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
  })

  it('runs ahead of linear without overshooting', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
    expect(easeOutCubic(0.5)).toBeLessThan(1)
  })
})

describe('puffOpacity', () => {
  it('shows the trailing puffs for cloud only', () => {
    expect(puffOpacity('cloud')).toBe(1)
    expect(puffOpacity('soft')).toBe(0)
    expect(puffOpacity('lightning')).toBe(0)
  })

  it('trails the puffs below and left of the ellipse, tapering away', () => {
    const radiiOf = CLOUD_PUFFS.map(p => p.r)
    expect(radiiOf).toEqual([...radiiOf].sort((a, b) => b - a))
    CLOUD_PUFFS.forEach(p => {
      expect(p.cy).toBeGreaterThan(BASE.cy)
      expect(p.cx).toBeLessThan(BASE.cx)
    })
  })
})

describe('resolveBubbleShape', () => {
  const bubble = {
    type: 'soft' as BubbleType,
    hoverType: 'cloud' as BubbleType | null,
    clickType: 'lightning' as BubbleType | null,
  }

  it('rests on the configured type', () => {
    expect(resolveBubbleShape(bubble, { hover: false, pulsing: false })).toBe('soft')
  })

  it('takes the hover shape while hovered', () => {
    expect(resolveBubbleShape(bubble, { hover: true, pulsing: false })).toBe('cloud')
  })

  it('lets a click pulse outrank a hover', () => {
    expect(resolveBubbleShape(bubble, { hover: true, pulsing: true })).toBe('lightning')
  })

  it('falls back to the resting shape when that event has none configured', () => {
    const plain = { type: 'lightning' as BubbleType, hoverType: null, clickType: null }
    expect(resolveBubbleShape(plain, { hover: true, pulsing: false })).toBe('lightning')
    expect(resolveBubbleShape(plain, { hover: true, pulsing: true })).toBe('lightning')
  })

  it('falls through a missing click shape to the hover shape', () => {
    const hoverOnly = { type: 'soft' as BubbleType, hoverType: 'cloud' as BubbleType, clickType: null }
    expect(resolveBubbleShape(hoverOnly, { hover: true, pulsing: true })).toBe('cloud')
  })
})

describe('BUBBLE_ASPECT', () => {
  it('matches the viewBox the outlines are authored in', () => {
    expect(BUBBLE_ASPECT).toBeCloseTo(BUBBLE_VIEW.h / BUBBLE_VIEW.w, 10)
  })

  it('keeps the base ellipse inside the box in both axes', () => {
    expect(BUBBLE_ELLIPSE_N.cx + BUBBLE_ELLIPSE_N.rx).toBeLessThanOrEqual(1)
    expect(BUBBLE_ELLIPSE_N.cy + BUBBLE_ELLIPSE_N.ry).toBeLessThanOrEqual(1)
  })
})
