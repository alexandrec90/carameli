import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import PanelImages from '../../skins/comic-book/PanelImages'
import { newNumberPad } from '../../skins/comic-book/editor/numberPadValidate'
import type { ImgTransform } from '../../skins/comic-book/editor/types'

// The wiring the resize bug lived in: PanelImages must hand a projected surface the
// picture's *rendered rect* — where the artwork's pixels land after the contain fit —
// not the frame box. A tall picture in a wide frame makes the two maximally different,
// so every assertion here fails if the surface is ever measured against the frame again.

const SRC = '/comic-book/logo.webp'
const BOUNDS = { x: 0, y: 0, w: 400, h: 300 }
const VP: [number, number][] = [
  [0, 0],
  [400, 0],
  [400, 300],
  [0, 300],
]

function img(): ImgTransform {
  return {
    panel: 0,
    src: SRC,
    alt: '',
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    anchor: 'center bottom',
    spill: false,
    numberPad: newNumberPad(),
  }
}

function draw(natSizes: Record<string, { w: number; h: number }>) {
  const view = render(
    <PanelImages
      images={[img()]}
      panel={0}
      bounds={BOUNDS}
      vp={VP}
      natSizes={natSizes}
      isRevealed={() => false}
      editing={false}
      onSettled={() => {}}
      onNatSize={() => {}}
    />,
  )
  return view.container.querySelector('.cb-number-pad-surface') as HTMLElement
}

describe('PanelImages projected surfaces', () => {
  // Frame 400×300, natural 200×600: contain fit is 0.5, so the artwork renders as a
  // 100×300 column centred at x=150. The default quad spans 10–90%, so the pad must be
  // 80×240 sitting at the rendered rect's origin — not 320×240 at the frame's.
  it('measures the surface against the rendered rect, not the frame', () => {
    const surface = draw({ [SRC]: { w: 200, h: 600 } })
    expect(surface.style.left).toBe('150px')
    expect(surface.style.top).toBe('0px')
    expect(surface.style.width).toBe('80px')
    expect(surface.style.height).toBe('240px')
  })

  // Before the natural size loads there is no rendered rect to measure, and the
  // fallback <img> fills the frame anyway — so the frame is briefly the right base.
  it('falls back to the frame until the natural size is known', () => {
    const surface = draw({})
    expect(surface.style.left).toBe('0px')
    expect(surface.style.top).toBe('0px')
    expect(surface.style.width).toBe('320px')
    expect(surface.style.height).toBe('240px')
  })
})
