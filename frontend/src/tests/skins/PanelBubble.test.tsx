import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import PanelBubble from '../../skins/comic-book/PanelBubble'
import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'

const bubble = (type: BubbleTransform['type'] = 'soft'): BubbleTransform => ({
  ...NEW_BUBBLE,
  panel: 0,
  type,
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

describe('PanelBubble input content', () => {
  it('renders a real input and reveals a hidden bubble when keyboard focus reaches it', () => {
    const { container } = render(
      <PanelBubble
        bubble={{ ...NEW_BUBBLE, panel: 0, content: 'input', text: 'Your name' }}
        visible={false}
        interactive
      />,
    )
    const root = container.querySelector('.cb-panel-bubble') as HTMLDivElement
    const input = screen.getByRole('textbox', { name: 'Speech bubble text' })
    expect(root.classList.contains('is-visible')).toBe(false)
    expect(root.getAttribute('aria-hidden')).toBeNull()

    fireEvent.focus(input)

    expect(root.classList.contains('is-visible')).toBe(true)
  })

  it('keeps ordinary lettering decorative rather than exposing a fake input', () => {
    const { container } = render(
      <PanelBubble
        bubble={{ ...NEW_BUBBLE, panel: 0, content: 'text', text: 'Hello!' }}
        visible
        interactive
      />,
    )
    const root = container.querySelector('.cb-panel-bubble') as HTMLDivElement
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Hello!')).toBeTruthy()
  })
})
