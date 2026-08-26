import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import PanelBubbles from '../../skins/comic-book/PanelBubbles'
import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'

// Which balloons on a panel dial, and which only look like they might. A `phone` balloon
// is the number pad's fallback — a page whose picture carries no keypad still has somewhere
// to type a number — so its Enter has to reach the softphone. An `input` balloon is free
// text, and a balloon inside a chain already spends its Enter on the conversation.

const bubble = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  ...NEW_BUBBLE,
  panel: 0,
  text: '',
  ...over,
})

function draw(bubbles: BubbleTransform[], onPhoneSubmit?: (value: string) => void) {
  return render(
    <PanelBubbles
      bubbles={bubbles}
      chains={[]}
      panel={0}
      clip="none"
      isVisible={() => true}
      interactive
      editing={false}
      onPhoneSubmit={onPhoneSubmit}
    />,
  )
}

describe('PanelBubbles phone balloons', () => {
  it('dials what was typed into a phone balloon when Enter is pressed', () => {
    const onPhoneSubmit = vi.fn()
    draw([bubble({ content: 'phone' })], onPhoneSubmit)
    const input = screen.getByRole('textbox', { name: 'Phone number' })

    fireEvent.change(input, { target: { value: '5145550100' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onPhoneSubmit).toHaveBeenCalledTimes(1)
    // Formatted as typed; the hook normalizes it back down to a dialable string.
    expect(onPhoneSubmit.mock.calls[0][0]).toMatch(/514/)
  })

  it('leaves an input balloon as free text rather than a dialler', () => {
    const onPhoneSubmit = vi.fn()
    draw([bubble({ content: 'input', text: 'Your name' })], onPhoneSubmit)
    const input = screen.getByRole('textbox', { name: 'Speech bubble text' })

    fireEvent.change(input, { target: { value: '5145550100' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onPhoneSubmit).not.toHaveBeenCalled()
    // Nothing was sent anywhere, so nothing was cleared either.
    expect((input as HTMLInputElement).value).toBe('5145550100')
  })

  it('does not dial from a phone balloon that is a chain slot', () => {
    const onPhoneSubmit = vi.fn()
    // Two linked templates make a conversation. The lower `right` is the sender's, so
    // the phone balloon here is the composer PanelBubbleChain draws — and its Enter
    // pushes a message into the thread rather than placing a call.
    draw(
      [
        bubble({ content: 'phone', chain: 'chain-1', right: 5 }),
        bubble({ content: 'text', chain: 'chain-1', right: 55, text: 'Hi' }),
      ],
      onPhoneSubmit,
    )

    const input = screen.getByRole('textbox', { name: 'Phone number' })
    fireEvent.change(input, { target: { value: '5145550100' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onPhoneSubmit).not.toHaveBeenCalled()
  })
})
