import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import PanelBubble from '../../skins/comic-book/PanelBubble'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'

const bubble = (type: BubbleTransform['type'] = 'soft'): BubbleTransform => ({
  panel: 0,
  top: 0,
  right: 0,
  width: 50,
  rotate: 0,
  spill: true,
  type,
  tail: 'down-left',
  text: 'Hello!',
  linkTo: null,
  hoverType: 'cloud',
  clickType: 'lightning',
})

describe('PanelBubble hit target', () => {
  it('enables pointer targeting on the painted outline, not its rectangular wrapper', () => {
    const { container } = render(<PanelBubble bubble={bubble()} visible interactive />)

    expect(container.querySelector('.cb-panel-bubble')?.classList).toContain('is-interactive')
    expect(container.querySelector('.cb-bubble-shape')?.getAttribute('pointer-events')).toBe(
      'visiblePainted',
    )
    expect(container.querySelector('.cb-bubble-puffs')?.getAttribute('pointer-events')).toBe('none')
  })

  it('includes visible thought-bubble puffs in the painted hit target', () => {
    const { container } = render(<PanelBubble bubble={bubble('cloud')} visible interactive />)

    expect(container.querySelector('.cb-bubble-puffs')?.getAttribute('pointer-events')).toBe(
      'visiblePainted',
    )
  })

  it('keeps the rendered bubble inert while the editor overlay owns interaction', () => {
    const { container } = render(
      <PanelBubble bubble={bubble('cloud')} visible interactive={false} />,
    )

    expect(container.querySelector('.cb-bubble-shape')?.getAttribute('pointer-events')).toBe('none')
    expect(container.querySelector('.cb-bubble-puffs')?.getAttribute('pointer-events')).toBe('none')
  })
})
