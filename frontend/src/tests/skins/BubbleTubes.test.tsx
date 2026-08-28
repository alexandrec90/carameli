import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import BubbleTubes from '../../skins/comic-book/BubbleTubes'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'
import type { PanelPoly } from '../../skins/comic-book/panelGeometry'

// One wide panel, so two balloons placed at its far ends have a clear span between
// their mouths and tubeBetween has a corridor to draw.
const POLYS: (PanelPoly | null)[] = [
  null,
  {
    vp: [[0, 0], [1000, 0], [1000, 300], [0, 300]],
    bounds: { x: 0, y: 0, w: 1000, h: 300 },
  },
]

const bub = (over: Partial<BubbleTransform>): BubbleTransform => ({
  panel: 1, top: 10, right: 0, width: 20, rotate: 0, spill: true, type: 'soft',
  tail: 'none', content: 'text', text: '', linkTo: null, hoverType: null,
  clickType: null, hoverBold: false, chain: '', ...over,
})

const LINKED = [bub({ right: 70, linkTo: 1 }), bub({ right: 0 })]

describe('BubbleTubes', () => {
  it('names the panel a tube belongs to, for the hover hit test', () => {
    // usePanelHover measures the drawn tubes of the hovered panel by this attribute:
    // a corridor through the gutter is that panel's ink, exactly as its balloons are.
    const { container } = render(
      <BubbleTubes polys={POLYS} bubbles={LINKED} isVisible={() => true} />,
    )
    const tubes = container.querySelectorAll('.cb-tube')
    expect(tubes).toHaveLength(1)
    expect(tubes[0].getAttribute('data-cb-panel')).toBe('1')
    expect(tubes[0].classList.contains('is-visible')).toBe(true)
    expect(tubes[0].querySelector('.cb-tube-fill')).not.toBeNull()
  })

  it('keeps a tube mounted but faded while either balloon is hidden', () => {
    const { container } = render(
      <BubbleTubes polys={POLYS} bubbles={LINKED} isVisible={i => i === 0} />,
    )
    const tube = container.querySelector('.cb-tube')
    expect(tube).not.toBeNull()
    expect(tube!.classList.contains('is-visible')).toBe(false)
  })

  it('renders nothing for a page with no linked pair', () => {
    const { container } = render(
      <BubbleTubes polys={POLYS} bubbles={[bub({})]} isVisible={() => true} />,
    )
    expect(container.querySelector('.cb-tube-svg')).toBeNull()
  })
})
