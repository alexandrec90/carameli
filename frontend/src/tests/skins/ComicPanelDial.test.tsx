import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ComicPanel from '../../skins/comic-book/ComicPanel'
import { NEW_BUBBLE, NEW_IMAGE } from '../../skins/comic-book/editor/configSeed'
import { newNumberPad } from '../../skins/comic-book/editor/numberPadValidate'
import type { BubbleTransform, ImgTransform } from '../../skins/comic-book/editor/types'
import { idleSms } from './smsStub'

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

function draw(bubbles: BubbleTransform[], onNumberPadKey = vi.fn(), onPhoneSubmit = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ComicPanel
        index={1}
        info={INFO}
        poly={POLY}
        images={[img({ numberPad: newNumberPad() })]}
        bubbles={bubbles}
        chains={[]}
        sms={idleSms()}
        natSizes={{}}
        editorActive={false}
        hovered
        onHover={() => undefined}
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
