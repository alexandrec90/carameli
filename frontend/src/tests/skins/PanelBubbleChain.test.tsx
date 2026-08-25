import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import PanelBubbleChain from '../../skins/comic-book/PanelBubbleChain'
import type { BubbleChain } from '../../skins/comic-book/bubbleChain'
import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'

// The DOM shell over bubbleChain.ts: how many balloons a column of N draws, which
// messages are in them, and the two things that move the window — the wheel, and a
// reader typing into a live chain's composer. The arithmetic itself is unit-tested in
// bubbleChain.test.ts.

const slot = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  ...NEW_BUBBLE,
  panel: 0,
  text: '',
  ...over,
})

/** A column of `n` drawn balloons, slot 0 first (the root). */
const column = (n: number, rootOver: Partial<BubbleTransform> = {}): BubbleTransform[] =>
  Array.from({ length: n }, (_, i) => slot(i === 0 ? rootOver : {}))

const chain = (over: Partial<BubbleChain> = {}): BubbleChain => ({
  id: 'chain-1',
  grow: false,
  stepMs: 900,
  messages: [],
  ...over,
})

const drawn = (container: HTMLElement) => container.querySelectorAll('.cb-panel-bubble')

const composer = () => screen.getByRole('textbox', { name: 'Speech bubble text' })

describe('PanelBubbleChain', () => {
  // Requirement, in the author's words: a chain of 3 shows between 1 and 3 balloons, and
  // ten messages through it is still three on screen.
  it('never draws more balloons than the author drew slots', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ messages: ['a', 'b', 'c', 'd', 'e'] })}
        slots={column(3)}
        visible
        interactive
      />,
    )
    expect(drawn(container)).toHaveLength(3)
  })

  it('draws one balloon per message while the thread is shorter than the column', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ messages: ['a', 'b'] })}
        slots={column(3)}
        visible
        interactive
      />,
    )
    expect(drawn(container)).toHaveLength(2)
  })

  it('puts the newest message it reaches in the root and older ones above it', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ messages: ['one', 'two', 'three', 'four'] })}
        slots={column(3)}
        visible
        interactive
      />,
    )
    expect([...drawn(container)].map(el => el.textContent)).toEqual(['three', 'two', 'one'])
    expect(screen.queryByText('four')).toBeNull()
  })

  it('moves the window rather than the column when the wheel is turned', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ messages: ['one', 'two', 'three', 'four'] })}
        slots={column(3)}
        visible
        interactive
      />,
    )
    const layer = container.querySelector('.cb-chain-layer') as HTMLDivElement

    // A notch down advances the head by one: the window slides, the balloon count does not.
    fireEvent.wheel(layer, { deltaY: 60 })

    expect([...drawn(container)].map(el => el.textContent)).toEqual(['four', 'three', 'two'])
  })

  it('stops at the start of the thread rather than scrolling past it', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ messages: ['one', 'two', 'three'] })}
        slots={column(3)}
        visible
        interactive
      />,
    )
    const layer = container.querySelector('.cb-chain-layer') as HTMLDivElement

    fireEvent.wheel(layer, { deltaY: -600 })

    expect([...drawn(container)].map(el => el.textContent)).toEqual(['one'])
  })
})

describe('PanelBubbleChain live chain', () => {
  const live = (n: number) => column(n, { content: 'input', text: 'Say something' })

  it('starts as a lone composer, since a thread nobody has written is empty', () => {
    const { container } = render(
      <PanelBubbleChain chain={chain()} slots={live(3)} visible interactive />,
    )
    expect(drawn(container)).toHaveLength(1)
    expect(composer()).toBeTruthy()
  })

  // The whole of "I type something, hit enter, that bubble moves up and an empty one takes
  // its place — the chain grows by 1".
  it('appends what was sent and grows the column by one balloon', () => {
    const { container } = render(
      <PanelBubbleChain chain={chain()} slots={live(3)} visible interactive />,
    )

    fireEvent.change(composer(), { target: { value: 'first' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    expect(drawn(container)).toHaveLength(2)
    expect(screen.getByText('first')).toBeTruthy()

    fireEvent.change(composer(), { target: { value: 'second' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    expect(drawn(container)).toHaveLength(3)
    expect([...drawn(container)].map(el => el.textContent)).toEqual([
      '', // the composer balloon, whose own text is the field's initial value
      'second',
      'first',
    ])
  })

  // The composer costs the root slot, so three drawn balloons hold the field and the two
  // newest messages — still three balloons, which is what the author drew.
  it('scrolls rather than growing once the drawn slots are full', () => {
    const { container } = render(
      <PanelBubbleChain chain={chain()} slots={live(3)} visible interactive />,
    )

    for (const text of ['one', 'two', 'three']) {
      fireEvent.change(composer(), { target: { value: text } })
      fireEvent.keyDown(composer(), { key: 'Enter' })
    }

    expect(drawn(container)).toHaveLength(3)
    expect(screen.getByText('three')).toBeTruthy()
    expect(screen.getByText('two')).toBeTruthy()
    expect(screen.queryByText('one')).toBeNull()
  })

  // A live chain does not fall back to the balloons' own words: the root's text is the
  // field's initial value and the slots above it are empty until a message reaches them.
  it('does not speak the drawn balloons’ own text', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain()}
        slots={[
          slot({ content: 'input', text: 'Say something' }),
          slot({ text: 'placeholder' }),
        ]}
        visible
        interactive
      />,
    )
    expect(drawn(container)).toHaveLength(1)
    expect(screen.queryByText('placeholder')).toBeNull()
  })

  it('keeps what the reader sent when the panel stops being hovered', () => {
    const { container, rerender } = render(
      <PanelBubbleChain chain={chain()} slots={live(3)} visible interactive />,
    )
    fireEvent.change(composer(), { target: { value: 'kept' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    rerender(<PanelBubbleChain chain={chain()} slots={live(3)} visible={false} interactive />)

    expect(drawn(container)).toHaveLength(2)
    expect(screen.getByText('kept')).toBeTruthy()
  })
})
