import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import PanelBubbleChain from '../../skins/comic-book/PanelBubbleChain'
import type { LiveConversation } from '../../skins/comic-book/PanelBubbleChain'
import { OUT_PREFIX } from '../../skins/comic-book/bubbleChain'
import type { BubbleChain } from '../../skins/comic-book/bubbleChain'
import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'
import { smsMessage } from './smsStub'

// A chain **bound to a real thread** — the `conversation` prop. Its own file rather than
// more of PanelBubbleChain.test.tsx, which is at the size limit, and the seam is clean:
// everything here is about a chain that is no longer drawing what the author wrote.
//
// The offline behaviour those tests cover is the thing this one has to displace, so the
// assertions are mostly negative in shape: the authored transcript is *not* drawn, a sent
// message is *not* kept locally. Both were how a chain worked until it was bound, so a
// regression here looks like the feature working rather than like a fault.

const tpl = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  ...NEW_BUBBLE,
  panel: 0,
  top: 60,
  right: 5,
  width: 40,
  text: '',
  ...over,
})

/** Sender template first, with a composer on it: a bound chain is always live. */
const columns = (): BubbleTransform[] => [
  tpl({ right: 5, content: 'input', text: 'Say something' }),
  tpl({ right: 55 }),
]

const chain = (over: Partial<BubbleChain> = {}): BubbleChain => ({
  id: 'chain-1',
  grow: false,
  stepMs: 900,
  rows: 4,
  sms: true,
  messages: [],
  ...over,
})

const drawn = (container: HTMLElement) => [...container.querySelectorAll('.cb-panel-bubble')]

const composer = () => screen.getByRole('textbox', { name: 'Speech bubble text' })

function bound(over: Partial<LiveConversation> = {}): LiveConversation {
  return { messages: [], onSend: vi.fn(), ...over }
}

describe('PanelBubbleChain, bound to a real conversation', () => {
  it('draws the carrier’s messages and not the authored transcript', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain({ messages: ['authored one', 'authored two'] })}
        members={columns()}
        visible
        interactive
        conversation={bound({ messages: [smsMessage({ id: 'a', text: 'from them' })] })}
      />,
    )

    expect(screen.getByText('from them')).toBeTruthy()
    expect(screen.queryByText('authored one')).toBeNull()
    // The message plus the composer.
    expect(drawn(container)).toHaveLength(2)
  })

  it('puts an outbound message in the sender’s column and an inbound one in the recipient’s', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound({
          messages: [
            smsMessage({ id: 'a', text: 'theirs', outbound: false, at: '2026-08-26T12:00:00Z' }),
            smsMessage({ id: 'b', text: 'mine', outbound: true, at: '2026-08-26T12:00:01Z' }),
          ],
        })}
      />,
    )

    const rightOf = (text: string) => {
      const el = drawn(container).find(e => e.textContent === text) as HTMLElement
      return parseFloat(el.style.right)
    }
    // The sender's column is the rightmost template, so its rows sit at a smaller `right`.
    expect(rightOf('mine')).toBeLessThan(rightOf('theirs'))
  })

  it('sends what the composer holds instead of keeping it', () => {
    const onSend = vi.fn()
    const { container } = render(
      <PanelBubbleChain
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound({ onSend })}
      />,
    )

    fireEvent.change(composer(), { target: { value: 'hello there' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    expect(onSend).toHaveBeenCalledWith('hello there')
    // Nothing local: the message reaches the panel by coming back from the server, which
    // is what makes a balloon on screen evidence it was actually accepted.
    expect(drawn(container)).toHaveLength(1)
    expect(screen.queryByText('hello there')).toBeNull()
  })

  it('shows a message that arrives without anyone having typed', () => {
    const { container, rerender } = render(
      <PanelBubbleChain
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound()}
      />,
    )
    expect(drawn(container)).toHaveLength(1)

    rerender(
      <PanelBubbleChain
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound({ messages: [smsMessage({ id: 'a', text: 'ping' })] })}
      />,
    )

    expect(screen.getByText('ping')).toBeTruthy()
  })

  it('scrolls a newly arrived message into the window', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        smsMessage({ id: `m${i}`, text: `m${i}`, at: `2026-08-26T12:00:${String(i).padStart(2, '0')}Z` }),
      )
    const { rerender } = render(
      <PanelBubbleChain
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound({ messages: many(6) })}
      />,
    )
    rerender(
      <PanelBubbleChain
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound({ messages: many(7) })}
      />,
    )

    // The newest is on screen and the oldest has scrolled off — a four-row table spends
    // one row on the composer, so it shows three messages.
    expect(screen.getByText('m6')).toBeTruthy()
    expect(screen.queryByText('m0')).toBeNull()
  })

  it('marks a message the carrier has not taken yet', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound({
          messages: [
            smsMessage({ id: 'a', text: 'going', outbound: true, status: 'sending' }),
            smsMessage({ id: 'b', text: 'gone', outbound: true, at: '2026-08-26T12:00:01Z' }),
          ],
        })}
      />,
    )

    const byText = (t: string) => drawn(container).find(e => e.textContent === t) as HTMLElement
    expect(byText('going').classList.contains('is-sending')).toBe(true)
    // A delivered message is just a message, so it carries no state class at all.
    expect(byText('gone').classList.contains('is-sending')).toBe(false)
    expect(byText('gone').classList.contains('is-failed')).toBe(false)
  })

  it('marks a message that failed to send', () => {
    const { container } = render(
      <PanelBubbleChain
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound({
          messages: [smsMessage({ id: 'a', text: 'nope', outbound: true, status: 'failed' })],
        })}
      />,
    )

    const el = drawn(container).find(e => e.textContent === 'nope') as HTMLElement
    expect(el.classList.contains('is-failed')).toBe(true)
  })

  it('never shows the sender marker as part of a message', () => {
    // `> ` is how a *side* is spelled in a transcript, not something anyone typed.
    render(
      <PanelBubbleChain
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound({ messages: [smsMessage({ id: 'a', text: 'mine', outbound: true })] })}
      />,
    )
    expect(screen.queryByText(`${OUT_PREFIX}mine`)).toBeNull()
    expect(screen.getByText('mine')).toBeTruthy()
  })
})
