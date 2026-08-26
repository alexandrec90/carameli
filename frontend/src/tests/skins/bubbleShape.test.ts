import { describe, expect, it } from 'vitest'

import { BOLT_SPIKES } from '../../skins/comic-book/boltShape'
import {
  BUBBLE_ASPECT,
  BUBBLE_ELLIPSE_N,
  BUBBLE_VIEW,
  ELLIPSE,
  RING_POINTS,
  TAIL_DIRS,
  TAIL_DIR_KEYS,
  cloudPuffs,
  tailRingIndex,
} from '../../skins/comic-book/bubbleBox'
import type { TailDir } from '../../skins/comic-book/bubbleBox'
import {
  bubbleShapeCandidates,
  easeOutCubic,
  hitPuffs,
  hitRingPoints,
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

/** How far a point sits from the base ellipse: 1 is on it, > 1 outside. */
function ellipseRadius([x, y]: [number, number]): number {
  return ((x - ELLIPSE.cx) / ELLIPSE.rx) ** 2 + ((y - ELLIPSE.cy) / ELLIPSE.ry) ** 2
}

/** The vertices of `type` that leave the base ellipse for tail `tail`. */
function offEllipse(type: BubbleType, tail: TailDir): [number, number][] {
  return pairs(ringPoints(type, tail)).filter(p => Math.abs(ellipseRadius(p) - 1) > 1e-6)
}

/** Every tail direction that actually draws one. */
const REAL_TAILS = TAIL_DIR_KEYS.filter(k => k !== 'none')
/**
 * Each vertex's radius in units of the base ellipse: 1 sits exactly on it, above 1
 * bulges out, below 1 cuts in. Reading shapes this way makes "meshed" and "spiky"
 * assertable without exporting the private modulation functions.
 */
function radii(type: BubbleType): number[] {
  return pairs(ringPoints(type)).map(([x, y]) =>
    Math.hypot((x - ELLIPSE.cx) / ELLIPSE.rx, (y - ELLIPSE.cy) / ELLIPSE.ry),
  )
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
  // It spans tail directions too, which is what lets the editor's tail dropdown
  // animate — turning a tail is the same interpolation as changing shape.
  it('gives every type and tail the identical vertex count so any pair can interpolate', () => {
    const lengths = new Set(
      BUBBLE_TYPE_KEYS.flatMap(t => TAIL_DIR_KEYS.map(dir => ringPoints(t, dir).length)),
    )
    expect(lengths.size).toBe(1)
  })

  it('produces only finite coordinates', () => {
    BUBBLE_TYPE_KEYS.forEach(type => {
      TAIL_DIR_KEYS.forEach(dir => {
        ringPoints(type, dir).forEach(n => expect(Number.isFinite(n)).toBe(true))
      })
    })
  })

  it('defaults to no tail, which leaves the whole ring inside the viewBox', () => {
    BUBBLE_TYPE_KEYS.forEach(type => {
      expect(ringPoints(type)).toEqual(ringPoints(type, 'none'))
      pairs(ringPoints(type)).forEach(([x, y]) => {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(BUBBLE_VIEW.w)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(BUBBLE_VIEW.h)
      })
    })
  })

  // Only the tail vertex is allowed out of the box (the SVG sets overflow: visible
  // for it). If a spike escaped too, the ink would extend somewhere no one chose.
  it('keeps every non-tail vertex inside the viewBox for every tail direction', () => {
    BUBBLE_TYPE_KEYS.forEach(type => {
      REAL_TAILS.forEach(dir => {
        pairs(ringPoints(type, dir)).forEach(([x, y], i) => {
          if (i === tailRingIndex(dir)) return
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(BUBBLE_VIEW.w)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThanOrEqual(BUBBLE_VIEW.h)
        })
      })
    })
  })

  it('starts at the top of the ellipse and runs clockwise', () => {
    const [top, next] = pairs(ringPoints('soft'))
    expect(top[0]).toBeCloseTo(ELLIPSE.cx, 6)
    expect(top[1]).toBeLessThan(ELLIPSE.cy)
    // Clockwise in screen coords: the next vertex is to the right and lower.
    expect(next[0]).toBeGreaterThan(top[0])
    expect(next[1]).toBeGreaterThan(top[1])
  })

  it('leaves the ring whole when the tail is none', () => {
    expect(offEllipse('soft', 'none')).toHaveLength(0)
  })

  it('puts every soft vertex on the base ellipse except the tail', () => {
    const off = offEllipse('soft', 'down-left')
    expect(off).toHaveLength(1)
    // …and that one is the tail, hanging below and left of centre.
    expect(off[0][1]).toBeGreaterThan(ELLIPSE.cy + ELLIPSE.ry)
    expect(off[0][0]).toBeLessThan(ELLIPSE.cx)
  })

  // The dropdown's whole promise: pick a direction, the tail goes there.
  it('points the tail the way the direction says, for all of them', () => {
    REAL_TAILS.forEach(dir => {
      const off = offEllipse('soft', dir)
      expect(off).toHaveLength(1)
      const { ux, uy } = TAIL_DIRS[dir]
      const dx = off[0][0] - ELLIPSE.cx
      const dy = off[0][1] - ELLIPSE.cy
      // Same half-plane as the requested direction on each axis it commits to.
      if (ux !== 0) expect(Math.sign(dx)).toBe(Math.sign(ux))
      if (uy !== 0) expect(Math.sign(dy)).toBe(Math.sign(uy))
      // And it reaches well outside the balloon rather than nudging the edge.
      expect(ellipseRadius(off[0])).toBeGreaterThan(2)
    })
  })

  it('grows a tail for soft and lightning and none for cloud', () => {
    REAL_TAILS.forEach(dir => {
      expect(offEllipse('soft', dir)).toHaveLength(1)
      expect(offEllipse('lightning', dir).length).toBeGreaterThan(0)
    })
    // A thought bubble trails puffs instead, so its ring never sprouts one: every
    // cloud vertex stays within the modulation's own bulge.
    REAL_TAILS.forEach(dir => {
      pairs(ringPoints('cloud', dir)).forEach(p => {
        expect(ellipseRadius(p)).toBeLessThan(1.3)
      })
    })
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

  // Spikes are triangles, so the outline spends its whole valley-to-crown swing on
  // the rise's few segments. A cosine of the same amplitude cannot: it eases into
  // and out of the crown, which is what made the old burst look soft.
  it('turns lightning corners abruptly rather than cresting a cosine', () => {
    expect(steepestStep(radii('lightning'))).toBeGreaterThan(0.3)
    expect(steepestStep(radii('cloud'))).toBeLessThan(0.1)
  })

  // The count the eye actually reads, asserted through the rendered ring rather than
  // through boltShape's table — a spike a retune flattened into its neighbour would
  // still be in the table but would not be a point on the outline.
  it('gives lightning one crest per authored spike', () => {
    expect(crests(radii('lightning'))).toHaveLength(BOLT_SPIKES)
  })

  // A sun is the failure mode to avoid: evenly spaced, identical, symmetric rays.
  // Every property below holds for a sun and must not hold here.
  it('varies lightning spike spacing and length so it cannot read as a sun', () => {
    const r = radii('lightning')
    const found = crests(r)
    // Not evenly spaced: the gaps between consecutive crests are not one number.
    const gaps = found.map((v, i) => (found[(i + 1) % found.length] - v + RING_POINTS) % RING_POINTS)
    expect(new Set(gaps).size).toBeGreaterThan(2)
    // Not one length: a handful project far past a body most spikes only stub out of.
    const heights = found.map(i => r[i])
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.35)
    expect(new Set(heights.map(h => h.toFixed(2))).size).toBeGreaterThan(12)
  })

  it('is deterministic, lightning included', () => {
    expect(ringPoints('lightning', 'up')).toEqual(ringPoints('lightning', 'up'))
  })
})

describe('tailRingIndex', () => {
  it('has no vertex to pull out when there is no tail', () => {
    expect(tailRingIndex('none')).toBe(-1)
  })

  it('lands on the ring vertex facing each direction', () => {
    // Index 0 is the top of the ellipse and the ring runs clockwise.
    expect(tailRingIndex('up')).toBe(0)
    expect(tailRingIndex('right')).toBe(RING_POINTS / 4)
    expect(tailRingIndex('down')).toBe(RING_POINTS / 2)
    expect(tailRingIndex('left')).toBe((RING_POINTS * 3) / 4)
  })

  it('gives every direction its own vertex', () => {
    expect(new Set(REAL_TAILS.map(tailRingIndex)).size).toBe(REAL_TAILS.length)
  })

  it('stays in range', () => {
    REAL_TAILS.forEach(dir => {
      expect(tailRingIndex(dir)).toBeGreaterThanOrEqual(0)
      expect(tailRingIndex(dir)).toBeLessThan(RING_POINTS)
    })
  })
})

describe('cloudPuffs', () => {
  it('trails nothing when there is no tail', () => {
    expect(cloudPuffs('none')).toEqual([])
  })

  it('tapers away from the balloon along the tail direction', () => {
    REAL_TAILS.forEach(dir => {
      const puffs = cloudPuffs(dir)
      expect(puffs.length).toBeGreaterThan(1)
      const radii = puffs.map(p => p.r)
      expect(radii).toEqual([...radii].sort((a, b) => b - a))
      const { ux, uy } = TAIL_DIRS[dir]
      puffs.forEach(p => {
        expect(ellipseRadius([p.cx, p.cy])).toBeGreaterThan(1)
        if (ux !== 0) expect(Math.sign(p.cx - ELLIPSE.cx)).toBe(Math.sign(ux))
        if (uy !== 0) expect(Math.sign(p.cy - ELLIPSE.cy)).toBe(Math.sign(uy))
      })
    })
  })

  it('keeps each puff further out than the last', () => {
    const dists = cloudPuffs('down-left').map(p =>
      Math.hypot(p.cx - ELLIPSE.cx, p.cy - ELLIPSE.cy),
    )
    expect(dists).toEqual([...dists].sort((a, b) => a - b))
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
  // across types and tails — only the numbers may differ.
  it('uses the same command sequence for every type and tail', () => {
    const shapes = BUBBLE_TYPE_KEYS.flatMap(t =>
      TAIL_DIR_KEYS.map(dir => commands(pathD(ringPoints(t, dir))).join('')),
    )
    expect(new Set(shapes).size).toBe(1)
  })

  it('rounds coordinates to at most 2 decimals', () => {
    expect(pathD(ringPoints('lightning', 'down-left'))).not.toMatch(/\d\.\d{3,}/)
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

  it('travels the tail across the ring rather than cutting it', () => {
    const from = ringPoints('soft', 'down-left')
    const to = ringPoints('soft', 'right')
    const mid = lerpPoints(from, to, 0.5)
    expect(mid).toHaveLength(RING_POINTS * 2)
    // Both tails are half-retracted at the midpoint: neither vertex is at either
    // endpoint's position, which is what makes it a morph and not a cut.
    const oldTail = tailRingIndex('down-left') * 2
    const newTail = tailRingIndex('right') * 2
    expect(mid[oldTail]).not.toBeCloseTo(from[oldTail], 3)
    expect(mid[newTail]).not.toBeCloseTo(to[newTail], 3)
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

describe('bubbleShapeCandidates', () => {
  it('lists every shape resolveBubbleShape could return, resting one first', () => {
    expect(
      bubbleShapeCandidates({ type: 'soft', hoverType: 'cloud', clickType: 'lightning' }),
    ).toEqual(['soft', 'cloud', 'lightning'])
  })

  it('drops the events that have no shape of their own', () => {
    expect(bubbleShapeCandidates({ type: 'cloud', hoverType: null, clickType: null })).toEqual([
      'cloud',
    ])
  })

  it('names a shape once however many events reach it', () => {
    expect(
      bubbleShapeCandidates({ type: 'soft', hoverType: 'soft', clickType: 'lightning' }),
    ).toEqual(['soft', 'lightning'])
  })
})

describe('hitRingPoints', () => {
  /**
   * Ray-cast point-in-polygon over a flat ring. The hit region is concave wherever a
   * cloud cusp survives the union, so "further from the centre at the same index" is
   * not enough on its own — containment has to be tested as containment.
   */
  function inside([x, y]: [number, number], ring: number[]): boolean {
    const v = pairs(ring)
    let hit = false
    for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
      const [xi, yi] = v[i]
      const [xj, yj] = v[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }

  it('emits the same ring the shapes do, so it is one closed outline like them', () => {
    BUBBLE_TYPE_KEYS.forEach(type =>
      expect(hitRingPoints(type, 'down-left')).toHaveLength(RING_POINTS * 2),
    )
  })

  /**
   * The property the whole hit region rests on: overlay one of these per shape a
   * bubble can take and a pointer resting on any of those shapes is on the region,
   * whichever one is drawn. Where that fails the hover cancels itself and the two
   * shapes trade places under a still cursor forever.
   */
  it('contains the shape it stands in for, for every tail', () => {
    BUBBLE_TYPE_KEYS.forEach(type => {
      TAIL_DIR_KEYS.forEach(dir => {
        const region = hitRingPoints(type, dir)
        pairs(ringPoints(type, dir)).forEach(p => {
          expect(inside(p, region)).toBe(true)
        })
      })
    })
  })

  it('reaches past the outline it covers, since the ink is stroked outside the path', () => {
    BUBBLE_TYPE_KEYS.forEach(type => {
      const drawn = pairs(ringPoints(type, 'none')).map(ellipseRadius)
      pairs(hitRingPoints(type, 'none'))
        .map(ellipseRadius)
        .forEach((r, i) => expect(r).toBeGreaterThan(drawn[i]))
    })
  })

  it('keeps the tail, so a bubble stays grabbable by the one part that leaves the box', () => {
    const [tipX, tipY] = pairs(hitRingPoints('soft', 'up'))[tailRingIndex('up')]

    expect(tipY).toBeLessThan(ELLIPSE.cy - ELLIPSE.ry)
    expect(tipX).toBeCloseTo(ELLIPSE.cx, 6)
  })
})

describe('hitPuffs', () => {
  it('covers the puffs of a shape the bubble only reaches on hover', () => {
    const b = { type: 'soft' as BubbleType, hoverType: 'cloud' as BubbleType, clickType: null }
    const drawn = cloudPuffs('down-left')

    expect(hitPuffs(b, 'down-left')).toHaveLength(drawn.length)
    hitPuffs(b, 'down-left').forEach((p, i) => {
      expect(p.cx).toBe(drawn[i].cx)
      expect(p.cy).toBe(drawn[i].cy)
      expect(p.r).toBeGreaterThan(drawn[i].r)
    })
  })

  it('grows none for a bubble no state turns into a cloud', () => {
    const b = { type: 'soft' as BubbleType, hoverType: 'lightning' as BubbleType, clickType: null }
    expect(hitPuffs(b, 'down-left')).toEqual([])
  })

  it('grows none where there is no tail for them to trail', () => {
    const b = { type: 'cloud' as BubbleType, hoverType: null, clickType: null }
    expect(hitPuffs(b, 'none')).toEqual([])
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

  it('describes the same ellipse as ELLIPSE, in box fractions', () => {
    expect(BUBBLE_ELLIPSE_N.cx * BUBBLE_VIEW.w).toBeCloseTo(ELLIPSE.cx, 10)
    expect(BUBBLE_ELLIPSE_N.cy * BUBBLE_VIEW.h).toBeCloseTo(ELLIPSE.cy, 10)
    expect(BUBBLE_ELLIPSE_N.rx * BUBBLE_VIEW.w).toBeCloseTo(ELLIPSE.rx, 10)
    expect(BUBBLE_ELLIPSE_N.ry * BUBBLE_VIEW.h).toBeCloseTo(ELLIPSE.ry, 10)
  })
})
