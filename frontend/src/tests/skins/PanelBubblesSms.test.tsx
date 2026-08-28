import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import PanelBubbles from '../../skins/comic-book/PanelBubbles'
import type { BubbleChain } from '../../skins/comic-book/bubbleChain'
import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'
import { idleSms, smsMessage } from './smsStub'

// The join between the two halves of a live panel: a wheel-picker balloon says *who* the
// conversation is with, and the chain beside it says what was said. Neither knows about
// the other — this component is the only place that decides they are a pair, so this is
// the only place the rule can be asserted.

const PEER = '+14155551111'
const OTHER = '+14155552222'

const tpl = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  ...NEW_BUBBLE,
  panel: 0,
  top: 60,
  right: 5,
  width: 40,
  text: '',
  ...over,
})

const picker = (over: Partial<BubbleTransform> = {}): BubbleTransform =>
  tpl({ content: 'wheel', text: `${PEER}, ${OTHER}`, top: 10, ...over })

/** A chain's two templates: sender (rightmost, with the composer) then recipient. */
const chainBubbles = (): BubbleTransform[] => [
  tpl({ chain: 'chain-1', right: 5, content: 'input', text: 'Say something' }),
  tpl({ chain: 'chain-1', right: 55 }),
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

function renderPanel(bubbles: BubbleTransform[], chains: BubbleChain[], sms = idleSms()) {
  return render(
    <PanelBubbles
      bubbles={bubbles}
      chains={chains}
      panel={0}
      clip="none"
      isVisible={() => true}
      interactive
      editing={false}
      sms={sms}
    />,
  )
}

describe('PanelBubbles, binding a chain to a number', () => {
  it('subscribes to the number the picker starts on', () => {
    const sms = idleSms()
    renderPanel([picker(), ...chainBubbles()], [chain()], sms)
    expect(sms.subscribe).toHaveBeenCalledWith(PEER)
  })

  it('draws the conversation the hook holds for that number', () => {
    const sms = idleSms({
      conversations: { [PEER]: [smsMessage({ id: 'a', text: 'from them' })] },
    })
    renderPanel([picker(), ...chainBubbles()], [chain()], sms)
    expect(screen.getByText('from them')).toBeTruthy()
  })

  it('does not draw another number’s conversation', () => {
    const sms = idleSms({
      conversations: { [OTHER]: [smsMessage({ id: 'a', text: 'not this one' })] },
    })
    renderPanel([picker(), ...chainBubbles()], [chain()], sms)
    expect(screen.queryByText('not this one')).toBeNull()
  })

  it('follows the picker to another number when the reader turns it', () => {
    const sms = idleSms({
      conversations: {
        [PEER]: [smsMessage({ id: 'a', text: 'first thread' })],
        [OTHER]: [smsMessage({ id: 'b', text: 'second thread' })],
      },
    })
    const { container } = renderPanel([picker(), ...chainBubbles()], [chain()], sms)
    expect(screen.getByText('first thread')).toBeTruthy()

    // One notch down the drum. The listener is on the balloon, not on the option list.
    const wheelHost = container.querySelector('.cb-bubble-wheel')?.closest('.cb-panel-bubble')
    fireEvent.wheel(wheelHost as Element, { deltaY: 200 })

    expect(screen.getByText('second thread')).toBeTruthy()
    expect(screen.queryByText('first thread')).toBeNull()
    expect(sms.subscribe).toHaveBeenCalledWith(OTHER)
  })

  it('sends to the number the picker is on', () => {
    const sms = idleSms()
    renderPanel([picker(), ...chainBubbles()], [chain()], sms)

    const composer = screen.getByRole('textbox', { name: 'Speech bubble text' })
    fireEvent.change(composer, { target: { value: 'hello' } })
    fireEvent.keyDown(composer, { key: 'Enter' })

    expect(sms.send).toHaveBeenCalledWith(PEER, 'hello')
  })

  it('reports the number it sent to, so the panel can keep it on the picker', () => {
    // The panel's own half of "a thread I started is a row I can turn back to"; what it
    // does with the number is ComicPanel's (see ComicPanelDial.test.tsx). Reported as the
    // picker spells it rather than as E.164, because the drum letters what the field does.
    const sms = idleSms()
    const onPeerTexted = vi.fn()
    render(
      <PanelBubbles
        bubbles={[picker(), ...chainBubbles()]}
        chains={[chain()]}
        panel={0}
        clip="none"
        isVisible={() => true}
        interactive
        editing={false}
        sms={sms}
        onPeerTexted={onPeerTexted}
      />,
    )

    const composer = screen.getByRole('textbox', { name: 'Speech bubble text' })
    fireEvent.change(composer, { target: { value: 'hello' } })
    fireEvent.keyDown(composer, { key: 'Enter' })

    expect(onPeerTexted).toHaveBeenCalledWith(PEER)
  })

  it('reports nothing until something is actually sent', () => {
    // A number that merely resolved is not a conversation: a reader part-way through
    // typing one passes through other people's numbers, and a drum that collected those
    // would be a list of near misses.
    const onPeerTexted = vi.fn()
    render(
      <PanelBubbles
        bubbles={[picker(), ...chainBubbles()]}
        chains={[chain()]}
        panel={0}
        clip="none"
        isVisible={() => true}
        interactive
        editing={false}
        sms={idleSms()}
        onPeerTexted={onPeerTexted}
      />,
    )

    expect(onPeerTexted).not.toHaveBeenCalled()
  })

  it('routes keyboard focus to the composer except while the phone thought bubble is hovered', () => {
    const { container } = render(
      <div className="cb-panel">
        <PanelBubbles
          bubbles={[picker({ content: 'dial', text: PEER }), ...chainBubbles()]}
          chains={[chain()]}
          panel={0}
          clip="none"
          isVisible={() => true}
          interactive
          editing={false}
          sms={idleSms()}
          dialValue={PEER}
        />
      </div>,
    )
    const composer = screen.getByRole('textbox', { name: 'Speech bubble text' })
    const phone = screen.getByRole('textbox', { name: 'Phone number' })
    const thought = phone.closest('.cb-panel-bubble') as HTMLElement

    expect(document.activeElement).toBe(composer)
    fireEvent.pointerEnter(thought)
    expect(document.activeElement).toBe(phone)
    fireEvent.pointerLeave(thought)
    expect(document.activeElement).toBe(composer)
    expect(container.querySelectorAll('.cb-dial-caret')).toHaveLength(2)
  })

  it('leaves a chain that did not ask to be bound alone', () => {
    const sms = idleSms({
      conversations: { [PEER]: [smsMessage({ id: 'a', text: 'real message' })] },
    })
    renderPanel([picker(), ...chainBubbles()], [chain({ sms: false, messages: ['authored'] })], sms)

    expect(screen.getByText('authored')).toBeTruthy()
    expect(screen.queryByText('real message')).toBeNull()
    expect(sms.subscribe).not.toHaveBeenCalled()
  })

  it('binds nothing on a panel with no picker', () => {
    const sms = idleSms()
    renderPanel(chainBubbles(), [chain()], sms)
    expect(sms.subscribe).not.toHaveBeenCalled()
  })

  it('binds nothing when the picker’s options are not phone numbers', () => {
    // A wheel of names is an ordinary comic balloon, not a broken conversation.
    const sms = idleSms()
    renderPanel([picker({ text: 'Ben, Gwen, Max' }), ...chainBubbles()], [chain()], sms)
    expect(sms.subscribe).not.toHaveBeenCalled()
  })

  it('normalises a nationally written option before subscribing', () => {
    // The same thread must not become two because the author wrote it differently.
    const sms = idleSms()
    renderPanel([picker({ text: '(415) 555-1111' }), ...chainBubbles()], [chain()], sms)
    expect(sms.subscribe).toHaveBeenCalledWith(PEER)
  })

  it('never binds in edit mode', () => {
    // The editor is the author placing balloons; a panel under it must not start polling
    // a carrier, and Enter in a composer there must not spend money.
    const sms = idleSms()
    render(
      <PanelBubbles
        bubbles={[picker(), ...chainBubbles()]}
        chains={[chain()]}
        panel={0}
        clip="none"
        isVisible={() => true}
        interactive={false}
        editing
        sms={sms}
      />,
    )
    expect(sms.subscribe).not.toHaveBeenCalled()
  })

  it('ignores a wheel balloon that is itself part of the chain', () => {
    // A picker inside a conversation is choosing what to *say*, not who to say it to.
    const sms = idleSms()
    renderPanel(
      [picker({ chain: 'chain-1' }), ...chainBubbles()],
      [chain()],
      sms,
    )
    expect(sms.subscribe).not.toHaveBeenCalled()
  })

  it('unsubscribes when the panel goes away', () => {
    const unsubscribe = vi.fn()
    const sms = idleSms({ subscribe: vi.fn(() => unsubscribe) })
    const { unmount } = renderPanel([picker(), ...chainBubbles()], [chain()], sms)
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
