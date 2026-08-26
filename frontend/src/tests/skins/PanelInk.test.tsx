import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import PanelInk from '../../skins/comic-book/PanelInk'
import type { PanelInkProps } from '../../skins/comic-book/PanelInk'
import type { PanelPoly } from '../../skins/comic-book/panelGeometry'

/**
 * The strongest form of "a picture is never inked": the ink layer is never handed one.
 *
 * This is a **compile-time** assertion — `lint:types` fails, not vitest — because the
 * runtime version cannot work. A re-added image loop would read a prop this file does
 * not pass and quietly draw nothing, so a test that counts polygons would stay green
 * while the app grew borders again. Widening the prop surface is the moment to fail, and
 * that moment is only visible to the type checker.
 *
 * If this line errors, someone is giving PanelInk knowledge of pictures. Pictures are
 * not panels: draw them in PanelImages, and leave this layer the panels.
 */
type SamePropsAs<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const INK_TAKES_ONLY_PANELS: SamePropsAs<keyof PanelInkProps, 'polys'> = true

const poly = (x: number): PanelPoly => ({
  vp: [[x, 0], [x + 100, 0], [x + 100, 100], [x, 100]],
  bounds: { x, y: 0, w: 100, h: 100 },
})

describe('PanelInk', () => {
  it('strokes one outline per panel and skips the null slots of the other page', () => {
    const { container } = render(<PanelInk polys={[poly(0), null, poly(200)]} />)
    const polygons = container.querySelectorAll('polygon')

    expect(polygons).toHaveLength(2)
    expect(polygons[0].getAttribute('points')).toBe('0,0 100,0 100,100 0,100')
    expect(polygons[1].getAttribute('points')).toBe('200,0 300,0 300,100 200,100')
  })

  // The reversion guard. A picture used to be inked here too — the panel's polygon
  // scaled into the picture's frame — so any picture the author had moved or resized
  // grew a 5 px black panel-shaped border that the editor's selection outline (which
  // traces the artwork's real rect) then contradicted on screen. Pictures are not
  // panels: this layer draws panels, and takes no pictures to draw.
  it('inks nothing but panels — a picture with a frame of its own gets no border', () => {
    // Handed pictures anyway (the shape of the prop this component used to take, hence
    // the cast), including one moved and resized well off the default full-panel frame.
    const props = {
      polys: [poly(0)],
      images: [
        { panel: 0, src: '/comic-book/logo.webp', alt: '', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center center', spill: false },
        { panel: 0, src: '/comic-book/logo.webp', alt: '', left: 20, top: 20, width: 45, height: 45, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center center', spill: false },
      ],
    }
    const Ink = PanelInk as unknown as (p: typeof props) => ReactElement
    const { container } = render(<Ink {...props} />)

    // One panel in, one outline out. Two, and the inset picture has been inked again.
    expect(container.querySelectorAll('polygon')).toHaveLength(1)
    // Reads the compile-time assertion above so it cannot be dropped as unused. Its
    // real failure mode is `lint:types`, not this expectation.
    expect(INK_TAKES_ONLY_PANELS).toBe(true)
  })
})
