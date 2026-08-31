import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ComicPanel from '../../skins/comic-book/ComicPanel'
import { NEW_BUBBLE, NEW_IMAGE } from '../../skins/comic-book/editor/configSeed'
import { newNumberPad } from '../../skins/comic-book/editor/numberPadValidate'
import type { BubbleTransform, ImgTransform } from '../../skins/comic-book/editor/types'
import { idleSms } from './smsStub'

// The 'dial-call' kind: a dial balloon with the telephone's green key at the right of its
// field. Everything the drum and the field do is ComicPanelDial.test.tsx's subject and is
// not re-asserted here — what is here is the key alone: when it is dialable, and that
// pressing it is the same call Enter places.
//
// Drawn through ComicPanel rather than BubbleDial directly, because the number the key
// reads is the *panel's* — the projected keypad writes to it too — so a component-level
// harness would be asserting against a value nothing owns.

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

function draw(bubbles: BubbleTransform[], { editing = false } = {}) {
  const onPhoneSubmit = vi.fn()
  render(
    <MemoryRouter initialEntries={['/']}>
      <ComicPanel
        index={1}
        info={INFO}
        poly={POLY}
        images={[img({ numberPad: newNumberPad() })]}
        bubbles={bubbles}
        chains={[]}
        callScenes={[]}
        sms={idleSms()}
        natSizes={{}}
        editorActive={editing}
        hovered
        isRevealed={() => false}
        isBubbleVisible={() => true}
        onNumberPadKey={vi.fn()}
        onPhoneSubmit={onPhoneSubmit}
        dotRef={() => undefined}
        onSettled={() => undefined}
        onNatSize={() => undefined}
      />
    </MemoryRouter>,
  )
  return {
    onPhoneSubmit,
    key: () => screen.queryByRole('button', { name: 'Call' }) as HTMLButtonElement | null,
    field: () => screen.getByRole('textbox', { name: 'Phone number' }) as HTMLInputElement,
    rows: () =>
      Array.from(document.querySelectorAll('.cb-wheel-option')).map(r => r.textContent),
  }
}

const dialCall = (text: string) => [bubble({ content: 'dial-call', text })]

describe('the call key of a dial-call balloon', () => {
  it('is drawn beside the field, which a plain dial is not', () => {
    // The whole difference between the two kinds, stated once: same balloon, one key.
    expect(draw([bubble({ content: 'dial', text: '5550001111' })]).key()).toBeNull()
  })

  it('is greyed with nothing dialled, since there is no destination yet', () => {
    const { key } = draw(dialCall(''))
    expect(key()!.disabled).toBe(true)
  })

  it('stays greyed while the number is still being typed', () => {
    // The eight keystrokes an area code passes through are prefixes of other people's
    // numbers; a key that looked live through them would place a call to one of them.
    const { field, key } = draw(dialCall(''))

    fireEvent.change(field(), { target: { value: '234' } })

    expect(key()!.disabled).toBe(true)
  })

  it('lights up once the number could be dialled', () => {
    const { field, key } = draw(dialCall(''))

    fireEvent.change(field(), { target: { value: '9998887777' } })

    expect(key()!.disabled).toBe(false)
  })

  it('is live from the start on a balloon seeded with a number', () => {
    // The drum seeds the field before the reader touches anything, and that seed is a
    // number — so the key must not wait for a keystroke to notice it.
    const { key, field } = draw(dialCall('2345679999, 5550001111'))

    expect(field().value).toBe('(234) 567-9999')
    expect(key()!.disabled).toBe(false)
  })

  it('is greyed on a shortlist of names, which are not numbers to dial', () => {
    const { key } = draw(dialCall('Reception, Dispatch'))
    expect(key()!.disabled).toBe(true)
  })

  it('places the call on the number as the field letters it', () => {
    const { field, key, onPhoneSubmit } = draw(dialCall('5550001111'))

    fireEvent.change(field(), { target: { value: '9998887777' } })
    fireEvent.click(key()!)

    expect(onPhoneSubmit).toHaveBeenCalledWith('(999) 888-7777')
  })

  it('adds what it dialled to the drum, exactly as Enter does', () => {
    // Pressing the key and pressing Enter run one handler, so the redial list grows the
    // same way whichever the reader used.
    const { field, key, rows } = draw(dialCall('5550001111'))

    fireEvent.change(field(), { target: { value: '9998887777' } })
    fireEvent.click(key()!)

    expect(rows()).toEqual(['(555) 000-1111', '(999) 888-7777'])
  })

  it('is drawn but dead in edit mode, where the overlay owns the pointer', () => {
    const { key } = draw(dialCall('5550001111'), { editing: true })

    expect(key()).not.toBeNull()
    expect(key()!.disabled).toBe(true)
  })
})
