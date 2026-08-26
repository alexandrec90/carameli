import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import PanelBubbleChain from '../../skins/comic-book/PanelBubbleChain'
import type { BubbleChain } from '../../skins/comic-book/bubbleChain'
import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'

// The DOM shell over bubbleChain.ts: how many rows a table of N draws, which messages are
// in them, which column each lands in, and the two things that move the window — the wheel,
// and a reader typing into a live chain's composer. The layout arithmetic itself is
// unit-tested in bubbleChain.test.ts.
//
// jsdom lays nothing out, so the panel measures 0 and the aspect stays at its default 1.
// That is exactly why the aspect is a parameter rather than a lookup: the row *order* and
// the column each row is in are what these assert, and neither depends on it.

const tpl = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  ...NEW_BUBBLE,
  panel: 0,
  top: 60,
  right: 5,
  width: 40,
  text: '',
  ...over,
})

/** The two templates a conversation is stamped from, rightmost (the sender's) first. */
const columns = (meOver: Partial<BubbleTransform> = {}): BubbleTransform[] => [
  tpl({ right: 5, tail: 'down-left', ...meOver }),
  tpl({ right: 55, tail: 'down-right' }),
]

const chain = (over: Partial<BubbleChain> = {}): BubbleChain => ({
  id: 'chain-1',
  grow: false,
  stepMs: 900,
  rows: 3,
  messages: [],
  ...over,
})

const drawn = (container: HTMLElement) => [...container.querySelectorAll('.cb-panel-bubble')]

const texts = (container: HTMLElement) => drawn(container).map(el => el.textContent)

/** A row's right edge and left edge, as the % the style resolved to. */
const edges = (el: Element) => {
  const { right, width } = (el as HTMLElement).style
  return { right: parseFloat(right), left: 100 - parseFloat(right) - parseFloat(width) }
}

const composer = () => screen.getByRole('textbox', { name: 'Speech bubble text' })

describe('PanelBubbleChain', () => {
  // The author's "at most X rows": five messages through a three-row table is three on
  // screen, and the wheel reaches the rest.
  it('never draws more rows than the table holds', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ messages: ['a', 'b', 'c', 'd', 'e'] })}
        members={columns()}
        visible
        interactive
      />,
    )
    expect(drawn(container)).toHaveLength(3)
  })

  it('draws one row per message while the conversation is shorter than the table', () => {
    const { container } = render(
      <PanelBubbleChain chain={chain({ messages: ['a', 'b'] })} members={columns()} visible interactive />,
    )
    expect(drawn(container)).toHaveLength(2)
  })

  it('puts the newest message it reaches at the bottom and older ones above it', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ messages: ['one', 'two', 'three', 'four'] })}
        members={columns()}
        visible
        interactive
      />,
    )
    expect(texts(container)).toEqual(['three', 'two', 'one'])
    expect(screen.queryByText('four')).toBeNull()
  })

  // The author's own picture: two of theirs in a row, then one of mine, then another of
  // theirs. The rows are the conversation's, not either column's.
  it('lets one party take two rows in a row, each on its own side', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ rows: 6, messages: ['hey', 'you around?', '> just picked up', 'any luck?'] })}
        members={columns()}
        visible
        interactive
      />,
    )
    expect(texts(container)).toEqual(['any luck?', 'just picked up', 'you around?', 'hey'])

    const [luck, picked, around, hey] = drawn(container)
    // The sender's row hangs off the right column's edge...
    expect(edges(picked).right).toBeCloseTo(5, 6)
    // ...and the recipient's off the left column's, whatever width their messages gave them.
    for (const el of [luck, around, hey]) expect(edges(el).left).toBeCloseTo(5, 6)
    expect(edges(around).right).not.toBeCloseTo(5, 6)
  })

  it('sizes each row to its own message, so the columns have a ragged edge', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ rows: 6, messages: ['ok', 'a much longer message than that one'] })}
        members={columns()}
        visible
        interactive
      />,
    )
    const [long, short] = drawn(container).map(el => parseFloat((el as HTMLElement).style.width))
    expect(short).toBeLessThan(long)
  })

  it('moves the window rather than the table when the wheel is turned', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ messages: ['one', 'two', 'three', 'four'] })}
        members={columns()}
        visible
        interactive
      />,
    )
    const layer = container.querySelector('.cb-chain-layer') as HTMLDivElement

    // A notch down advances the head by one: the window slides, the row count does not.
    fireEvent.wheel(layer, { deltaY: 60 })

    expect(texts(container)).toEqual(['four', 'three', 'two'])
  })

  it('stops at the start of the conversation rather than scrolling past it', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ messages: ['one', 'two', 'three'] })}
        members={columns()}
        visible
        interactive
      />,
    )
    const layer = container.querySelector('.cb-chain-layer') as HTMLDivElement

    fireEvent.wheel(layer, { deltaY: -600 })

    expect(texts(container)).toEqual(['one'])
  })

  // A conversation with only one balloon drawn is still a conversation: the missing column
  // is the drawn one mirrored, so the author sees the shape before drawing the other side.
  it('mirrors the one template a half-drawn chain has', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ messages: ['theirs', '> mine'] })}
        members={[tpl({ right: 5 })]}
        visible
        interactive
      />,
    )
    const [mine, theirs] = drawn(container)
    expect(edges(mine).right).toBeCloseTo(5, 6)
    expect(edges(theirs).left).toBeCloseTo(5, 6)
  })
})

describe('PanelBubbleChain live chain', () => {
  const live = (over: Partial<BubbleChain> = {}) => ({
    chain: chain(over),
    members: columns({ content: 'input', text: 'Say something' }),
  })

  it('starts as a lone composer, since a conversation nobody has written is empty', () => {
    const { container } = render(<PanelBubbleChain {...live()} visible interactive />)
    expect(drawn(container)).toHaveLength(1)
    expect(composer()).toBeTruthy()
  })

  // The whole of "that's where they type in a new message and send it".
  it('appends what was sent and grows the table by one row', () => {
    const { container } = render(<PanelBubbleChain {...live()} visible interactive />)

    fireEvent.change(composer(), { target: { value: 'first' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    expect(drawn(container)).toHaveLength(2)
    expect(screen.getByText('first')).toBeTruthy()

    fireEvent.change(composer(), { target: { value: 'second' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    expect(drawn(container)).toHaveLength(3)
    expect(texts(container)).toEqual([
      '', // the composer balloon, whose own text is the field's initial value
      'second',
      'first',
    ])
  })

  it('sends into the sender’s column, above the composer it was typed into', () => {
    const { container } = render(<PanelBubbleChain {...live({ rows: 6, messages: ['hey'] })} visible interactive />)

    fireEvent.change(composer(), { target: { value: 'mine' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    const [field, sent, theirs] = drawn(container)
    expect(texts(container)).toEqual(['', 'mine', 'hey'])
    expect(edges(sent).right).toBeCloseTo(edges(field).right, 6)
    expect(edges(theirs).left).toBeCloseTo(5, 6)
  })

  // The composer costs the bottom row, so a three-row table is the field and the two newest
  // messages — still three rows, which is what the author asked for.
  it('scrolls rather than growing once the table is full', () => {
    const { container } = render(<PanelBubbleChain {...live()} visible interactive />)

    for (const text of ['one', 'two', 'three']) {
      fireEvent.change(composer(), { target: { value: text } })
      fireEvent.keyDown(composer(), { key: 'Enter' })
    }

    expect(drawn(container)).toHaveLength(3)
    expect(screen.getByText('three')).toBeTruthy()
    expect(screen.getByText('two')).toBeTruthy()
    expect(screen.queryByText('one')).toBeNull()
  })

  // A live chain does not fall back to the templates' own words: the sender's text is the
  // field's initial value, and the recipient's is not a message anyone has sent.
  it('does not speak the drawn templates’ own text', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain()}
        members={[
          tpl({ right: 5, content: 'input', text: 'Say something' }),
          tpl({ right: 55, text: 'placeholder' }),
        ]}
        visible
        interactive
      />,
    )
    expect(drawn(container)).toHaveLength(1)
    expect(screen.queryByText('placeholder')).toBeNull()
  })

  it('keeps what the reader sent when the panel stops being hovered', () => {
    const { container, rerender } = render(<PanelBubbleChain {...live()} visible interactive />)
    fireEvent.change(composer(), { target: { value: 'kept' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    rerender(<PanelBubbleChain {...live()} visible={false} interactive />)

    expect(drawn(container)).toHaveLength(2)
    expect(screen.getByText('kept')).toBeTruthy()
  })
})
