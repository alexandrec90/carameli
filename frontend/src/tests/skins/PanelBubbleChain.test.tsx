import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  sms: false,
  messages: [],
  ...over,
})

/**
 * The panel box the templates resolve against, sized so tubes and rows have room: tall
 * enough that the row gap (`CHAIN_ROW_GAP`, 1.5% of the height) clears a tube's minimum
 * even between two rows stacked straight over each other.
 */
const BOX = { x: 0, y: 0, w: 400, h: 600 }

/** A lettering size the box has room for: a column holds a short line on one row. */
const LETTERING = 12

const drawn = (container: HTMLElement) => [...container.querySelectorAll('.cb-panel-bubble')]

const texts = (container: HTMLElement) => drawn(container).map(el => el.textContent)

/** A row's right edge and left edge, as the % the style resolved to. */
const edges = (el: Element) => {
  const { right, width } = (el as HTMLElement).style
  return { right: parseFloat(right), left: 100 - parseFloat(right) - parseFloat(width) }
}

const composer = () => screen.getByRole('textbox', { name: 'Speech bubble text' })

/**
 * How much taller than its aspect a balloon is drawn, read back off the outline the way
 * the browser sees it: `stretch` reaches the DOM as the SVG's `aspect-ratio`, which is
 * the authored width over the authored height times the stretch (see PanelBubble).
 */
const stretchOf = (el: Element) => {
  const svg = el.querySelector<SVGElement>('.cb-panel-bubble-svg')
  const [w, h] = (svg?.style.aspectRatio ?? '').split('/').map(part => parseFloat(part))
  return h / w
}

afterEach(() => vi.restoreAllMocks())

describe('PanelBubbleChain', () => {
  it('draws vertical connector tubes between consecutive rows of each column', () => {
    const { container } = render(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
        chain={chain({ rows: 4, messages: ['theirs one', '> mine one', 'theirs two', '> mine two'] })}
        members={columns()}
        visible
        interactive
      />,
    )
    expect(container.querySelectorAll('.cb-chain-tubes .cb-tube')).toHaveLength(2)
  })

  // The author's "at most X rows": five messages through a three-row table is three on
  // screen, and the wheel reaches the rest.
  it('never draws more rows than the table holds', () => {
    const { container } = render(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
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
      <PanelBubbleChain box={BOX} lettering={LETTERING} chain={chain({ messages: ['a', 'b'] })} members={columns()} visible interactive />,
    )
    expect(drawn(container)).toHaveLength(2)
  })

  it('puts the newest message it reaches at the bottom and older ones above it', () => {
    const { container } = render(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
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
      <PanelBubbleChain box={BOX} lettering={LETTERING}
        chain={chain({ rows: 6, messages: ['hey', 'you around?', '> just picked up', 'any luck?'] })}
        members={columns()}
        visible
        interactive
      />,
    )
    expect(texts(container)).toEqual(['any luck?', 'just picked up', 'you around?', 'hey'])

    const [luck, picked, around, hey] = drawn(container)
    // The sender's row stays inside the right column (right 5, width 40)...
    expect(edges(picked).right).toBeGreaterThanOrEqual(5)
    expect(edges(picked).left).toBeGreaterThanOrEqual(55 - 1e-9)
    // ...and the recipient's inside the left one, whatever width their messages gave them.
    for (const el of [luck, around, hey]) {
      expect(edges(el).left).toBeGreaterThanOrEqual(5 - 1e-9)
      expect(edges(el).right).toBeGreaterThanOrEqual(55 - 1e-9)
    }
    expect(edges(around).right).not.toBeCloseTo(5, 6)
  })

  // The zig-zag: consecutive stacked rows of one speaker do not line up on their column's
  // edge. The bottom row is the exception — it sits on its template's tail tip instead.
  it('leans every other row of a speaker in from the column’s edge', () => {
    const { container } = render(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
        chain={chain({ rows: 6, messages: ['hey', 'you around?', 'any luck?', 'still there?'] })}
        members={columns()}
        visible
        interactive
      />,
    )
    const [, ...lefts] = drawn(container).map(el => edges(el).left)
    expect(lefts[0]).not.toBeCloseTo(lefts[1], 6)
    expect(lefts[1]).not.toBeCloseTo(lefts[2], 6)
    expect(lefts[0]).toBeCloseTo(lefts[2], 6)
  })

  // A message that wraps is drawn taller than the balloon's fixed aspect: the outline SVG
  // is stretched, and stretched alike on every row of the same message.
  it('draws a message that wraps in a taller balloon', () => {
    const { container } = render(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
        chain={chain({ rows: 6, messages: ['ok', 'a much longer message than the column can letter on one line'] })}
        members={columns()}
        visible
        interactive
      />,
    )
    const ratio = (el: Element) =>
      (el.querySelector('.cb-panel-bubble-svg') as SVGElement).style.aspectRatio
    const [long, short] = drawn(container)
    expect(ratio(short)).toBe('200 / 150')
    expect(ratio(long)).not.toBe('200 / 150')
    expect(long.querySelector('.cb-panel-bubble-svg')?.getAttribute('preserveAspectRatio')).toBe('none')
  })

  it('sizes each row to its own message, so the columns have a ragged edge', () => {
    const { container } = render(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
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
      <PanelBubbleChain box={BOX} lettering={LETTERING}
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

  // "At most X rows" is also "at least X rows once there are X messages". The window is a
  // pane of a fixed size: scrolling back moves the conversation through it. It used to
  // walk the head down to the first message and leave one balloon under two blank rows,
  // which reads as the table shrinking rather than as the thread scrolling.
  it('keeps the table full when the reader scrolls back through a long conversation', () => {
    const { container } = render(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
        chain={chain({ messages: ['one', 'two', 'three', 'four', 'five'] })}
        members={columns()}
        visible
        interactive
      />,
    )
    const layer = container.querySelector('.cb-chain-layer') as HTMLDivElement

    fireEvent.wheel(layer, { deltaY: -600 })

    expect(texts(container)).toEqual(['three', 'two', 'one'])
  })

  // The same clamp, on a transcript that never filled the table: the whole conversation is
  // already on screen, so the wheel has nothing to reach and takes nothing away either.
  it('stops at the start of a conversation shorter than the table', () => {
    const { container } = render(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
        chain={chain({ messages: ['one', 'two'] })}
        members={columns()}
        visible
        interactive
      />,
    )
    const layer = container.querySelector('.cb-chain-layer') as HTMLDivElement

    fireEvent.wheel(layer, { deltaY: -600 })

    expect(texts(container)).toEqual(['two', 'one'])
  })

  // A conversation with only one balloon drawn is still a conversation: the missing column
  // is the drawn one mirrored, so the author sees the shape before drawing the other side.
  it('mirrors the one template a half-drawn chain has', () => {
    const { container } = render(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
        chain={chain({ messages: ['theirs', '> mine'] })}
        members={[tpl({ right: 5 })]}
        visible
        interactive
      />,
    )
    const [mine, theirs] = drawn(container)
    // Inside the drawn column on the right, and inside its mirror on the left.
    expect(edges(mine).right).toBeGreaterThanOrEqual(5)
    expect(edges(mine).left).toBeGreaterThanOrEqual(55 - 1e-9)
    expect(edges(theirs).left).toBeGreaterThanOrEqual(5 - 1e-9)
    expect(edges(theirs).right).toBeGreaterThanOrEqual(55 - 1e-9)
  })
})

describe('PanelBubbleChain live chain', () => {
  const live = (over: Partial<BubbleChain> = {}) => ({
    chain: chain(over),
    members: columns({ content: 'input', text: 'Say something' }),
  })

  it('starts as a lone composer, since a conversation nobody has written is empty', () => {
    const { container } = render(<PanelBubbleChain box={BOX} lettering={LETTERING} {...live()} visible interactive />)
    expect(drawn(container)).toHaveLength(1)
    expect(composer()).toBeTruthy()
  })

  // The whole of "that's where they type in a new message and send it".
  it('appends what was sent and grows the table by one row', () => {
    const { container } = render(<PanelBubbleChain box={BOX} lettering={LETTERING} {...live()} visible interactive />)

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
    const { container } = render(<PanelBubbleChain box={BOX} lettering={LETTERING} {...live({ rows: 6, messages: ['hey'] })} visible interactive />)

    fireEvent.change(composer(), { target: { value: 'mine' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    const [field, sent, theirs] = drawn(container)
    expect(texts(container)).toEqual(['', 'mine', 'hey'])
    // Inside the composer's column, which is the sender's.
    expect(edges(sent).right).toBeGreaterThanOrEqual(edges(field).right)
    expect(edges(sent).left).toBeGreaterThanOrEqual(edges(field).left - 1e-9)
    // And theirs stays in the recipient's column, on their template's tail tip.
    expect(edges(theirs).left).toBeGreaterThanOrEqual(5 - 1e-9)
    expect(edges(theirs).right).toBeGreaterThanOrEqual(55 - 1e-9)
  })

  // The composer costs the bottom row, so a three-row table is the field and the two newest
  // messages — still three rows, which is what the author asked for.
  it('scrolls rather than growing once the table is full', () => {
    const { container } = render(<PanelBubbleChain box={BOX} lettering={LETTERING} {...live()} visible interactive />)

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
      <PanelBubbleChain box={BOX} lettering={LETTERING}
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

  // The field is a textarea, so a long message wraps inside the ink instead of scrolling
  // sideways out of it, and the balloon is fitted to the same draft so there is somewhere
  // for the second line to go. Both halves fail on their own: words with no room wrap out
  // through the outline, room with no wrapping is a taller balloon holding one long line.
  it('grows the composer’s balloon around what is being typed into it', () => {
    const { container } = render(<PanelBubbleChain box={BOX} lettering={LETTERING} {...live()} visible interactive />)
    const field = composer()
    expect(field.tagName).toBe('TEXTAREA')
    const before = stretchOf(drawn(container)[0])

    fireEvent.change(field, { target: { value: 'a message long enough to wrap onto more than one line' } })

    const typing = stretchOf(drawn(container)[0])
    expect(typing).toBeGreaterThan(before)

    // And back to the balloon the author drew once the message is gone from the field.
    fireEvent.change(composer(), { target: { value: '' } })
    expect(stretchOf(drawn(container)[0])).toBeCloseTo(before, 9)
  })

  it('keeps what the reader sent when the panel stops being hovered', () => {
    const { container, rerender } = render(<PanelBubbleChain box={BOX} lettering={LETTERING} {...live()} visible interactive />)
    fireEvent.change(composer(), { target: { value: 'kept' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    rerender(<PanelBubbleChain box={BOX} lettering={LETTERING} {...live()} visible={false} interactive />)

    expect(drawn(container)).toHaveLength(2)
    expect(screen.getByText('kept')).toBeTruthy()
  })
})
