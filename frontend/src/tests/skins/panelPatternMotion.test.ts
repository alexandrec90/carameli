import { describe, expect, it } from 'vitest'

import {
  PANEL_BG_CONFIGS,
  PATTERN_STYLE_KEYS,
  drawPanelBackground,
} from '../../skins/comic-book/panelPatterns'

// Every background style has to move with its clock — that is what "add animations
// for the other background types" means, and it is invisible to the dispatch test
// in panelLayouts.test.ts, which only asks that a style paints *something*.

/**
 * A recording 2D-context stand-in that yields one comparable string per draw.
 *
 * Dot **radius is deliberately left out** of the signature. Radius is the one thing
 * the shared `breathe` term touches, so a style with no motion of its own would
 * still look animated if radius were included — the test would pass on breathing
 * alone. What survives here is geometry and ink: where dots and rays are, and at
 * what alpha. A style whose output differs on those has genuinely moved.
 */
function signatureAt(style: string, t: number): string {
  const ops: string[] = []
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
    lineTo: (x: number, y: number) => ops.push(`line ${n(x)} ${n(y)}`),
    arc: (x: number, y: number) => ops.push(`arc ${n(x)} ${n(y)}`),
    fill: () => ops.push(`fill ${String(ctx.fillStyle)}`),
  }
  drawPanelBackground(
    ctx as unknown as CanvasRenderingContext2D,
    320, 240,
    style as (typeof PATTERN_STYLE_KEYS)[number],
    PANEL_BG_CONFIGS[0],
    t,
  )
  return ops.join('|')
}

describe('panel background motion', () => {
  // 3 s apart is exactly one `breathe` cycle, so the breathing term is identical at
  // both samples — a second guard alongside dropping radius from the signature.
  it.each(PATTERN_STYLE_KEYS.map(k => [k] as const))('%s animates with its clock', style => {
    expect(signatureAt(style, 3)).not.toBe(signatureAt(style, 0))
  })

  it.each(PATTERN_STYLE_KEYS.map(k => [k] as const))('%s is a pure function of its clock', style => {
    // A resting panel is redrawn at the clock it froze on when its canvas is
    // resized; that redraw has to reproduce the same frame, not a fresh one.
    expect(signatureAt(style, 4.25)).toBe(signatureAt(style, 4.25))
  })

  it.each(PATTERN_STYLE_KEYS.map(k => [k] as const))('%s paints the same dot count as it drifts', style => {
    // Drift moves dots and changes their ink; it must not make them appear and
    // vanish. A style that dropped dots between frames would flicker rather than
    // glide, which is the opposite of the slow read these are tuned for.
    const count = (t: number) => signatureAt(style, t).split('arc ').length
    expect(count(1)).toBe(count(1 + 1 / 60))
  })
})
