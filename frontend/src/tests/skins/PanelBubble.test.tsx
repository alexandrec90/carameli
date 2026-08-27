import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import PanelBubble from '../../skins/comic-book/PanelBubble'
import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'

const bubble = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  ...NEW_BUBBLE,
  panel: 0,
  ...over,
})

/** Opacity of the drawn thought puffs — 1 only while the bubble is a cloud. */
const puffOpacityOf = (container: HTMLElement): string =>
  (container.querySelector('.cb-bubble-puffs') as SVGGElement).style.opacity

describe('PanelBubble hit target', () => {
  it('targets an unpainted hit region, not the painted outline or its rectangular wrapper', () => {
    const { container } = render(<PanelBubble bubble={bubble()} visible interactive />)

    expect(container.querySelector('.cb-panel-bubble')?.classList).toContain('is-interactive')
    expect(container.querySelector('.cb-bubble-hit')?.getAttribute('pointer-events')).toBe('all')
    expect(container.querySelector('.cb-bubble-hit path')?.getAttribute('d')).toMatch(/^M /)
    expect(container.querySelector('.cb-bubble-shape')?.getAttribute('pointer-events')).toBe('none')
    expect(container.querySelector('.cb-bubble-puffs')?.getAttribute('pointer-events')).toBe('none')
  })

  it('covers the thought puffs of a shape the bubble only takes on hover', () => {
    const soft = render(<PanelBubble bubble={bubble()} visible interactive />)
    expect(soft.container.querySelectorAll('.cb-bubble-hit circle')).toHaveLength(0)

    const { container } = render(
      <PanelBubble bubble={bubble({ hoverType: 'cloud' })} visible interactive />,
    )

    expect(container.querySelectorAll('.cb-bubble-hit circle').length).toBeGreaterThan(0)
  })

  it('keeps the rendered bubble inert while the editor overlay owns interaction', () => {
    const { container } = render(
      <PanelBubble bubble={bubble({ type: 'cloud' })} visible interactive={false} />,
    )

    expect(container.querySelector('.cb-bubble-hit')?.getAttribute('pointer-events')).toBe('none')
    expect(container.querySelector('.cb-bubble-shape')?.getAttribute('pointer-events')).toBe('none')
    expect(container.querySelector('.cb-bubble-puffs')?.getAttribute('pointer-events')).toBe('none')
  })

  it('holds one hit region across hover and press, so a morph cannot drop the pointer', () => {
    // The regression: with the hit region derived from the drawn shape, hovering here
    // swapped a soft ellipse for a cusped cloud, the cursor fell outside it, the hover
    // dropped, the ellipse came back — and a still cursor oscillated forever.
    const { container } = render(
      <PanelBubble
        bubble={bubble({ hoverType: 'cloud', clickType: 'lightning' })}
        visible
        interactive
      />,
    )
    const root = container.querySelector('.cb-panel-bubble') as HTMLDivElement
    const hit = container.querySelector('.cb-bubble-hit') as SVGGElement
    const region = (): string =>
      [...hit.children].map(c => c.getAttribute('d') ?? c.getAttribute('r')).join('|')
    const resting = region()
    expect(hit.querySelectorAll('path')).toHaveLength(3) // one per shape it can take
    expect(puffOpacityOf(container)).toBe('0')

    fireEvent.pointerEnter(root)

    expect(puffOpacityOf(container)).toBe('1') // the hover really did land
    expect(region()).toBe(resting)

    fireEvent.pointerDown(root)

    expect(puffOpacityOf(container)).toBe('0') // …and the press shape outranks it
    expect(region()).toBe(resting)
  })

  it('keeps the hover while the pointer steps from the outline onto a real input', () => {
    // The wrapper handles enter and leave for exactly this: the input is the other
    // thing in a bubble that takes a pointer, and hanging the handlers off the outline
    // made reaching for it a leave — which dropped the hover shape mid-reach.
    const { container } = render(
      <PanelBubble
        bubble={bubble({ content: 'input', text: 'Name', hoverType: 'cloud' })}
        visible
        interactive
      />,
    )
    const outline = container.querySelector('.cb-bubble-hit path') as SVGPathElement
    const input = screen.getByRole('textbox', { name: 'Speech bubble text' })

    fireEvent.pointerOver(outline)
    expect(puffOpacityOf(container)).toBe('1')

    fireEvent.pointerOut(outline, { relatedTarget: input })
    fireEvent.pointerOver(input, { relatedTarget: outline })

    expect(puffOpacityOf(container)).toBe('1')

    // …and leaving the bubble altogether still ends it, so the above is a real
    // synthesized traversal rather than a leave nothing would have fired anyway.
    fireEvent.pointerOut(input, { relatedTarget: document.body })
    fireEvent.pointerOver(document.body, { relatedTarget: input })

    expect(puffOpacityOf(container)).toBe('0')
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

describe('PanelBubble action buttons', () => {
  it('renders one real button per comma-delimited entry', () => {
    const { container } = render(
      <PanelBubble
        bubble={{ ...NEW_BUBBLE, panel: 0, content: 'actions', text: 'Call, End call' }}
        visible
        interactive
      />,
    )
    const root = container.querySelector('.cb-panel-bubble') as HTMLDivElement
    // Real controls, so the bubble is not hidden from assistive tech.
    expect(root.getAttribute('aria-hidden')).toBeNull()
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Call', 'End call'])
  })

  it('keeps a press on a button from reaching the panel underneath', () => {
    const onClick = vi.fn()
    const onPointerDown = vi.fn()
    const onKeyDown = vi.fn()
    // The panel is an ordinary ancestor of the balloon, so listen outside the React root
    // and watch the native events: React's stopPropagation stops those too, and an
    // ancestor listening in the DOM needs no interactive wrapper element to spy with.
    const panel = document.createElement('div')
    const root = document.createElement('div')
    panel.appendChild(root)
    document.body.appendChild(panel)
    panel.addEventListener('click', onClick)
    panel.addEventListener('pointerdown', onPointerDown)
    panel.addEventListener('keydown', onKeyDown)
    render(
      <PanelBubble
        bubble={{ ...NEW_BUBBLE, panel: 0, content: 'actions', text: 'Call, End call' }}
        visible
        interactive
      />,
      { container: root },
    )
    const button = screen.getByRole('button', { name: 'Call' })

    fireEvent.pointerDown(button)
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'Enter' })

    expect(onPointerDown).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
    expect(onKeyDown).not.toHaveBeenCalled()

    // …and the same listener does see a press that lands on the balloon itself, so the
    // three above are the buttons swallowing it rather than the events going nowhere.
    fireEvent.pointerDown(root.querySelector('.cb-panel-bubble') as HTMLDivElement)

    expect(onPointerDown).toHaveBeenCalled()
  })

  it('disables the buttons while the editor overlay owns interaction', () => {
    render(
      <PanelBubble
        bubble={{ ...NEW_BUBBLE, panel: 0, content: 'actions', text: 'Call, End call' }}
        visible
        interactive={false}
      />,
    )
    screen.getAllByRole('button').forEach(b => {
      expect(b).toHaveProperty('disabled', true)
    })
  })
})
