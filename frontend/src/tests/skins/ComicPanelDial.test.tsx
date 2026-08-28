import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ComicPanel from '../../skins/comic-book/ComicPanel'
import type { BubbleChain } from '../../skins/comic-book/bubbleChain'
import { NEW_BUBBLE, NEW_IMAGE } from '../../skins/comic-book/editor/configSeed'
import { newNumberPad } from '../../skins/comic-book/editor/numberPadValidate'
import type { BubbleTransform, ImgTransform } from '../../skins/comic-book/editor/types'
import { idleSms, smsMessage } from './smsStub'

// The seam the 'dial' kind exists for: a number pad projected onto a *picture* and a
// balloon on the same panel are two ways of typing one number. ComicPanel is the only
// component that can see both, so this is where that wiring is asserted.

const INFO = { label: 'Switchboard', isLogo: false, path: '/phone-lines', page: 'classic' as const }
const POLY = {
  vp: [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][],
  bounds: { x: 0, y: 0, w: 100, h: 100 },
}

const img = (over: Partial<ImgTransform> = {}): ImgTransform => ({ ...NEW_IMAGE, panel: 1, ...over })
const bubble = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  ...NEW_BUBBLE,
  panel: 1,
  ...over,
})

beforeEach(() => vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']))
afterEach(() => vi.restoreAllMocks())

interface DrawOver {
  chains?: BubbleChain[]
  sms?: ReturnType<typeof idleSms>
}

function draw(
  bubbles: BubbleTransform[],
  { chains = [], sms = idleSms() }: DrawOver = {},
  onNumberPadKey = vi.fn(),
  onPhoneSubmit = vi.fn(),
) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ComicPanel
        index={1}
        info={INFO}
        poly={POLY}
        images={[img({ numberPad: newNumberPad() })]}
        bubbles={bubbles}
        chains={chains}
        sms={sms}
        natSizes={{}}
        editorActive={false}
        hovered
        isRevealed={() => false}
        isBubbleVisible={() => true}
        onNumberPadKey={onNumberPadKey}
        onPhoneSubmit={onPhoneSubmit}
        dotRef={() => undefined}
        onSettled={() => undefined}
        onNatSize={() => undefined}
      />
    </MemoryRouter>,
  )
  return {
    onNumberPadKey,
    onPhoneSubmit,
    press: (key: string) => fireEvent.pointerDown(screen.getByRole('button', { name: key })),
    field: () => screen.queryByRole('textbox', { name: 'Phone number' }) as HTMLInputElement | null,
    rows: () =>
      Array.from(document.querySelectorAll('.cb-wheel-option')).map(r => r.textContent),
  }
}

describe('a panel holding a dial balloon', () => {
  const dial = (text: string) => [bubble({ content: 'dial', text })]

  it('starts the field on the first option, the way a wheel starts on its first row', () => {
    const { field } = draw(dial('2345679999, 5550001111'))
    expect(field()!.value).toBe('(234) 567-9999')
  })

  it('types the projected keypad’s presses into the balloon, formatted', () => {
    const { press, field } = draw(dial(''))

    for (const key of ['5', '5', '5', '0', '0', '0', '1', '1', '1', '1']) press(key)

    expect(field()!.value).toBe('(555) 000-1111')
  })

  it('keeps a star or hash punched in on the pad', () => {
    // libphonenumber deletes both, which used to make those two keys look broken.
    const { press, field } = draw(dial(''))

    press('star')
    press('6')
    press('7')

    expect(field()!.value).toBe('*67')
  })

  it('takes the pad away from the page handler, rather than typing into two places', () => {
    const { press, onNumberPadKey } = draw(dial(''))

    press('5')

    expect(onNumberPadKey).not.toHaveBeenCalled()
  })

  it('dials what was punched in when Enter is pressed in the balloon', () => {
    const { press, field, onPhoneSubmit } = draw(dial(''))

    press('2')
    press('3')
    fireEvent.keyDown(field()!, { key: 'Enter' })

    expect(onPhoneSubmit).toHaveBeenCalledWith('23')
  })

  it('adds the keypad’s digits to a number already typed by hand', () => {
    const { press, field } = draw(dial(''))

    fireEvent.change(field()!, { target: { value: '555000111' } })
    press('1')

    expect(field()!.value).toBe('(555) 000-1111')
  })

  it('narrows the shortlist as the projected keypad is punched, the way typing does', () => {
    // The pad and the keyboard are one field, so they are one filter too. No clearing
    // first: the balloon starts on its first option, which is the drum's number, and
    // the first press starts a new number over it.
    const { press, rows } = draw(dial('5550001111, 5550002222, 2345679999'))

    press('5')
    press('5')

    expect(rows()).toEqual(['(555) 000-1111', '(555) 000-2222'])
  })

  it('starts a new number when the pad is punched over the seeded option', () => {
    // The seed is finished, exactly as it is for a keystroke: punching the pad dials
    // afresh instead of growing a number nobody is composing.
    const { press, field } = draw(dial('2345679999, 5550001111'))

    press('5')

    expect(field()!.value).toBe('5')
  })

  it('starts over on the next press after a number is dialled', () => {
    const { field, press, rows } = draw(dial('5550001111'))

    fireEvent.change(field()!, { target: { value: '9998887777' } })
    fireEvent.keyDown(field()!, { key: 'Enter' })
    press('9')

    // A new call, with the number just dialled kept on the drum as a redial row.
    expect(field()!.value).toBe('9')
    expect(rows()).toEqual(['(999) 888-7777'])
  })

  it('turns the drum on a scroll anywhere over the panel, since its bubbles show', () => {
    // isBubbleVisible is true here, so the balloon is revealed and the dial's wheel
    // covers the whole panel element — the reach the keyboard already has.
    const { field } = draw(dial('2345679999, 5550001111'))

    fireEvent.wheel(document.querySelector('.cb-panel')!, { deltaY: 60 })

    expect(field()!.value).toBe('(555) 000-1111')
  })

  it('saves a dialled number to the shortlist, so the drum becomes a redial list', () => {
    const { field, rows } = draw(dial('5550001111'))

    fireEvent.change(field()!, { target: { value: '9998887777' } })
    fireEvent.keyDown(field()!, { key: 'Enter' })

    expect(rows()).toEqual(['(555) 000-1111', '(999) 888-7777'])
    // And the drum lands on it with the filter cleared: the whole list is there again.
    expect(document.querySelector('.cb-wheel-option.is-selected')?.textContent)
      .toBe('(999) 888-7777')
    expect(field()!.value).toBe('(999) 888-7777')
  })

  it('does not list a dialled number twice, however it was spelled', () => {
    const { field, rows } = draw(dial('5550001111'))

    fireEvent.change(field()!, { target: { value: '5550001111' } })
    fireEvent.keyDown(field()!, { key: 'Enter' })

    expect(rows()).toEqual(['(555) 000-1111'])
  })

  it('still places the call, so saving the number is an addition and not a replacement', () => {
    const { field, onPhoneSubmit } = draw(dial('5550001111'))

    fireEvent.change(field()!, { target: { value: '9998887777' } })
    fireEvent.keyDown(field()!, { key: 'Enter' })

    expect(onPhoneSubmit).toHaveBeenCalledWith('(999) 888-7777')
  })
})

describe('a panel whose dial picks the peer of an SMS chain', () => {
  // The other seam ComicPanel owns: the thought bubble says *who*, the chain beside it
  // says *what*, and the shortlist is the only thing that remembers a number the reader
  // typed. Without that, a conversation started on a typed number is reachable exactly
  // once — turning the drum away from it is a one-way door.
  const PEER = '+14155551111'
  const OTHER = '+14155552222'

  const chainBubbles = (): BubbleTransform[] => [
    bubble({ chain: 'chain-1', right: 5, content: 'input', text: '' }),
    bubble({ chain: 'chain-1', right: 55 }),
  ]
  const smsChain = (): BubbleChain[] => [
    { id: 'chain-1', grow: false, stepMs: 900, rows: 4, sms: true, messages: [] },
  ]
  const bothThreads = () =>
    idleSms({
      conversations: {
        [PEER]: [smsMessage({ id: 'a', text: 'first thread' })],
        [OTHER]: [smsMessage({ id: 'b', text: 'second thread' })],
      },
    })

  it('keeps a number a message was sent to, so the reader can turn back to that thread', () => {
    const sms = bothThreads()
    const { field, rows } = draw(
      [bubble({ content: 'dial', text: '4155551111' }), ...chainBubbles()],
      { chains: smsChain(), sms },
    )
    expect(screen.getByText('first thread')).toBeTruthy()

    // A number the author never listed, typed into the thought bubble. It binds at once —
    // but it has narrowed the drum to nothing, so there is no row to come back to.
    fireEvent.change(field()!, { target: { value: '4155552222' } })
    expect(screen.getByText('second thread')).toBeTruthy()
    expect(rows()).toEqual([])

    const composer = screen.getByRole('textbox', { name: 'Speech bubble text' })
    fireEvent.change(composer, { target: { value: 'hello' } })
    fireEvent.keyDown(composer, { key: 'Enter' })

    expect(sms.send).toHaveBeenCalledWith(OTHER, 'hello')
    // Sending made it a row of the drum, with the filter cleared and both threads on it.
    expect(rows()).toEqual(['(415) 555-1111', '(415) 555-2222'])

    // Which is the whole point: the two conversations are now one scroll apart.
    const thought = field()!.closest('.cb-panel-bubble') as HTMLElement
    fireEvent.wheel(thought, { deltaY: -200 })
    expect(field()!.value).toBe('(415) 555-1111')
    expect(screen.getByText('first thread')).toBeTruthy()

    fireEvent.wheel(thought, { deltaY: 200 })
    expect(field()!.value).toBe('(415) 555-2222')
    expect(screen.getByText('second thread')).toBeTruthy()
  })

  it('leaves the shortlist alone until a message is actually sent', () => {
    const { field, rows } = draw(
      [bubble({ content: 'dial', text: '4155551111' }), ...chainBubbles()],
      { chains: smsChain(), sms: bothThreads() },
    )

    fireEvent.change(field()!, { target: { value: '4155552222' } })
    fireEvent.change(field()!, { target: { value: '4155551111' } })

    expect(rows()).toEqual(['(415) 555-1111'])
  })

  it('does not list a texted number twice when the author already offered it', () => {
    const { rows } = draw(
      [bubble({ content: 'dial', text: '4155551111' }), ...chainBubbles()],
      { chains: smsChain(), sms: bothThreads() },
    )

    const composer = screen.getByRole('textbox', { name: 'Speech bubble text' })
    fireEvent.change(composer, { target: { value: 'hello' } })
    fireEvent.keyDown(composer, { key: 'Enter' })

    expect(rows()).toEqual(['(415) 555-1111'])
  })
})

describe('a panel with no dial balloon', () => {
  it('leaves the projected keypad going wherever it went before', () => {
    const { press, onNumberPadKey, field } = draw([bubble({ content: 'wheel', text: '555' })])

    press('7')

    expect(onNumberPadKey).toHaveBeenCalledWith('7')
    expect(field()).toBeNull()
  })

  it('ignores a dial that is part of a chain, since that field composes a message', () => {
    const { press, onNumberPadKey } = draw([bubble({ content: 'dial', chain: 'chain-1' })])

    press('7')

    expect(onNumberPadKey).toHaveBeenCalledWith('7')
  })
})
