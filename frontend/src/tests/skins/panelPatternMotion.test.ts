import { describe, expect, it } from 'vitest'

import {
  PANEL_BG_CONFIGS,
  PATTERN_STYLE_KEYS,
  type PanelBgConfig,
  drawPanelBackground,
} from '../../skins/comic-book/panelPatterns'
import { SPIN_RATE } from '../../skins/comic-book/patternWave'

// Every background style has to move with its clock — that is what "add animations
// for the other background types" means, and it is invisible to the dispatch test
// in panelLayouts.test.ts, which only asks that a style paints *something*.

const W = 320, H = 240

interface Frame {
  /** Every op, joined — geometry and ink, deliberately without dot radius. */
  signature: string
  /** Each dot as painted: where it is and how big. */
  arcs: { x: number, y: number, r: number }[]
  /** Every `lineTo` endpoint, in order — a ray fan's outer corners. */
  lines: { x: number, y: number }[]
}

/**
 * Paint one frame against a recording 2D-context stand-in.
 *
 * Dot **radius is left out of `signature`**. Radius is the one thing the shared
 * `breathe` term touches, so a style with no motion of its own would still look
 * animated if radius were included — the test would pass on breathing alone. What
 * survives there is geometry and ink: where dots and rays are, and at what alpha.
 * Radius is kept separately in `arcs` for the tests that are about size.
 */
function frameAt(style: string, t: number, cfg: PanelBgConfig = PANEL_BG_CONFIGS[0]): Frame {
  const ops: string[] = []
  const arcs: Frame['arcs'] = []
  const lines: Frame['lines'] = []
  const n = (v: number) => v.toFixed(2)
  const ctx = {
    fillStyle: '' as string,
    strokeStyle: '',
    clearRect: () => ops.push('clear'),
    fillRect: (x: number, y: number, w: number, h: number) =>
      ops.push(`rect ${n(x)} ${n(y)} ${n(w)} ${n(h)} ${String(ctx.fillStyle)}`),
    beginPath: () => ops.push('begin'),
    closePath: () => ops.push('close'),
    moveTo: (x: number, y: number) => ops.push(`move ${n(x)} ${n(y)}`),
    lineTo: (x: number, y: number) => {
      lines.push({ x, y })
      ops.push(`line ${n(x)} ${n(y)}`)
    },
    arc: (x: number, y: number, r: number) => {
      arcs.push({ x, y, r })
      ops.push(`arc ${n(x)} ${n(y)}`)
    },
    fill: () => ops.push(`fill ${String(ctx.fillStyle)}`),
  }
  drawPanelBackground(
    ctx as unknown as CanvasRenderingContext2D,
    W, H,
    style as (typeof PATTERN_STYLE_KEYS)[number],
    cfg,
    t,
  )
  return { signature: ops.join('|'), arcs, lines }
}

/** The angle of a ray fan's first wedge, measured from its focal point. */
function firstRayAngle(style: string, cfg: PanelBgConfig, t: number): number {
  const { lines } = frameAt(style, t, cfg)
  const fx = (cfg.focalX ?? cfg.cornerX ?? 0) * W
  const fy = (cfg.focalY ?? cfg.cornerY ?? 0) * H
  return Math.atan2(lines[0].y - fy, lines[0].x - fx)
}

describe('panel background motion', () => {
  // 3 s apart is exactly one `breathe` cycle, so the breathing term is identical at
  // both samples — a second guard alongside dropping radius from the signature.
  it.each(PATTERN_STYLE_KEYS.map(k => [k] as const))('%s animates with its clock', style => {
    expect(frameAt(style, 3).signature).not.toBe(frameAt(style, 0).signature)
  })

  it.each(PATTERN_STYLE_KEYS.map(k => [k] as const))('%s is a pure function of its clock', style => {
    // A resting panel is redrawn at the clock it froze on when its canvas is
    // resized; that redraw has to reproduce the same frame, not a fresh one.
    expect(frameAt(style, 4.25).signature).toBe(frameAt(style, 4.25).signature)
  })

  it.each(PATTERN_STYLE_KEYS.map(k => [k] as const))('%s paints the same dot count as it drifts', style => {
    // Drift moves dots and changes their ink; it must not make them appear and
    // vanish. A style that dropped dots between frames would flicker rather than
    // glide, which is the opposite of the slow read these are tuned for.
    //
    // Every shipped tuning, not just one: each renderer culls dots below a radius
    // of about half a pixel, so a wave that swings a small `baseRadius` under that
    // floor is a flicker that only the panel using that tuning would ever show.
    for (const [i, cfg] of PANEL_BG_CONFIGS.entries()) {
      const count = (t: number) => frameAt(style, t, cfg).arcs.length
      expect(count(1), `${style} on config ${String(i)}`).toBe(count(1 + 1 / 60))
    }
  })
})

describe('ray fans', () => {
  // The rays of `sunburst` and `corner-burst` are one wheel drawn from two places.
  // `corner-burst` used to rock about a fixed axis and open and closed its spread
  // instead, which read as a twitch; it turns now, at sunburst's rate.
  it.each([
    ['sunburst', PANEL_BG_CONFIGS[1]],
    ['corner-burst', PANEL_BG_CONFIGS[7]],
  ] as const)('%s turns at a steady rate', (style, cfg) => {
    const a0 = firstRayAngle(style, cfg, 0)
    const a1 = firstRayAngle(style, cfg, 20)
    const a2 = firstRayAngle(style, cfg, 40)
    expect(a1 - a0).toBeCloseTo(20 * SPIN_RATE, 6)
    expect(a2 - a1).toBeCloseTo(20 * SPIN_RATE, 6)
  })

  it('paints no fully transparent wedges', () => {
    // The gaps between rays are the background showing through. Filling them at
    // zero alpha was half the fan's draw calls for no pixels.
    expect(frameAt('sunburst', 2, PANEL_BG_CONFIGS[1]).signature).not.toContain(',0.0)')
  })
})

describe('diagonal stripes', () => {
  it('grades dot size continuously rather than snapping between two bands', () => {
    // The bands used to have hard edges and slide as a block: a dot at a boundary
    // jumped between two sizes on every pass, which read as fast and mechanical
    // however low the rate went. It is a travelling wave now, like concentric
    // rings — so the sizes it paints are a spread, not a pair.
    const radii = frameAt('diagonal-stripes', 1.5, PANEL_BG_CONFIGS[5])
      .arcs.map(a => a.r.toFixed(2))
    expect(new Set(radii).size).toBeGreaterThan(10)
  })
})
