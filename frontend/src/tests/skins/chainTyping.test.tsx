import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import PanelBubbleChain from '../../skins/comic-book/PanelBubbleChain'
import type { LiveConversation } from '../../skins/comic-book/PanelBubbleChain'
import {
  chainColumns, conversationRows, readTranscript, TYPING_KEY,
} from '../../skins/comic-book/bubbleChain'
import type { BubbleChain } from '../../skins/comic-book/bubbleChain'
import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'
import { smsMessage } from './smsStub'

// The typing-dots row — the peer's balloon before there are words. Half of this is the
// pure arithmetic (conversationRows growing an extra row from the recipient's template),
// half the shell (PanelBubbleChain drawing it as `is-typing` dots and paying for it out
// of the message window).

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

/** The panel box the templates resolve against, sized so tubes and rows have room. */
const BOX = { x: 0, y: 0, w: 400, h: 300 }

/** A lettering size the box has room for: a column holds a short line on one row. */
const LETTERING = 12

/** The same, as the pure arithmetic takes it. */
const M = { aspect: 1, boxW: BOX.w, lettering: LETTERING }

const drawn = (container: HTMLElement) => [...container.querySelectorAll('.cb-panel-bubble')]

function bound(over: Partial<LiveConversation> = {}): LiveConversation {
  return { messages: [], onSend: vi.fn(), ...over }
}

describe('conversationRows with a typing row', () => {
  const cols = () => {
    const c = chainColumns(columns())
    if (!c) throw new Error('columns() must resolve')
    return c
  }

  it('appends one extra row from the recipient template, keyed for the shell', () => {
    const rows = conversationRows([0], readTranscript(['hello']), cols(), true, M, true)
    const typing = rows.find(r => r.key === TYPING_KEY)
    expect(typing).toBeTruthy()
    // The peer's side: aligned against the left column's edge, saying nothing.
    expect(typing?.bubble.text).toBe('')
    expect(typing?.bubble.content).toBe('text')
    const left = 100 - (typing?.bubble.right ?? 0) - (typing?.bubble.width ?? 0)
    expect(left).toBeGreaterThanOrEqual(5 - 1e-9)
    expect(left + (typing?.bubble.width ?? 0)).toBeLessThanOrEqual(45 + 1e-9)
  })

  // The dots stand in for the reply, so they lean where it will: when the words land the
  // balloon is where the dots were, rather than a lean to the side of them.
  it('leans where the reply it stands in for will lean', () => {
    const before = conversationRows([0], readTranscript(['hello']), cols(), true, M, true)
    const typing = before.find(r => r.key === TYPING_KEY)
    const after = conversationRows([1, 0], readTranscript(['hello', 'reply']), cols(), true, M)
    const reply = after.find(r => r.key === '1')
    expect(reply?.bubble.right).toBeCloseTo(typing?.bubble.right ?? -1, 6)
  })

  it('takes the recipient tail, as the newest thing on their side', () => {
    const rows = conversationRows([0], readTranscript(['hello']), cols(), true, M, true)
    const typing = rows.find(r => r.key === TYPING_KEY)
    const message = rows.find(r => r.key === '0')
    // The inbound message above the dots loses its tail to them — one tail per side.
    expect(typing?.bubble.tail).toBe(cols().them.tail)
    expect(message?.bubble.tail).toBe('none')
  })

  it('adds nothing when typing is off', () => {
    const rows = conversationRows([0], readTranscript(['hello']), cols(), true, M)
    expect(rows.some(r => r.key === TYPING_KEY)).toBe(false)
  })
})

describe('PanelBubbleChain with a composing peer', () => {
  it('draws the dots row, marked is-typing, above the composer', () => {
    const { container } = render(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound({ typing: true })}
      />,
    )

    const dots = drawn(container).find(e => e.classList.contains('is-typing'))
    expect(dots).toBeTruthy()
    expect(dots?.querySelectorAll('.cb-typing-dot')).toHaveLength(3)
  })

  it('draws no dots while the peer is not composing', () => {
    const { container } = render(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound({ typing: false })}
      />,
    )
    expect(drawn(container).some(e => e.classList.contains('is-typing'))).toBe(false)
    expect(container.querySelector('.cb-typing')).toBeNull()
  })

  it('spends a message row on the dots, so the oldest visible message yields', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        smsMessage({ id: `m${i}`, text: `m${i}`, at: `2026-08-26T12:00:${String(i).padStart(2, '0')}Z` }),
      )
    // A four-row chain holds three messages; with the dots up, two.
    const { rerender } = render(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound({ messages: many(3) })}
      />,
    )
    expect(screen.getByText('m0')).toBeTruthy()

    rerender(
      <PanelBubbleChain box={BOX} lettering={LETTERING}
        chain={chain()}
        members={columns()}
        visible
        interactive
        conversation={bound({ messages: many(3), typing: true })}
      />,
    )
    expect(screen.getByText('m2')).toBeTruthy()
    expect(screen.queryByText('m0')).toBeNull()
  })
})
