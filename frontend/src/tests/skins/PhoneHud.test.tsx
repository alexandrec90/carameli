import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { UseSoftphoneResult } from '../../hooks/useSoftphone'
import PhoneHud, { hudIsVisible, pageCanDial } from '../../skins/comic-book/PhoneHud'
import { NEW_BUBBLE, NEW_IMAGE } from '../../skins/comic-book/editor/configSeed'
import { newNumberPad } from '../../skins/comic-book/editor/numberPadValidate'
import type { BubbleTransform, ImgTransform } from '../../skins/comic-book/editor/types'

function makePhone(over: Partial<UseSoftphoneResult> = {}): UseSoftphoneResult {
  return {
    extensions: [],
    selectedId: 'ext-1',
    select: vi.fn(),
    status: 'offline',
    callStatus: 'idle',
    remoteParty: '',
    registeredAs: '',
    dialTarget: '',
    setDialTarget: vi.fn(),
    muted: false,
    error: '',
    busy: false,
    connect: vi.fn().mockResolvedValue(undefined),
    rotateCredential: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    dial: vi.fn().mockResolvedValue(undefined),
    autoDial: vi.fn().mockResolvedValue(undefined),
    answer: vi.fn().mockResolvedValue(undefined),
    decline: vi.fn().mockResolvedValue(undefined),
    hangup: vi.fn().mockResolvedValue(undefined),
    toggleMute: vi.fn(),
    pressDigit: vi.fn(),
    ...over,
  }
}

describe('hudIsVisible', () => {
  it('keeps the furniture off the picture until the phone is in use', () => {
    expect(hudIsVisible(makePhone())).toBe(false)
    expect(hudIsVisible(makePhone({ dialTarget: '4' }))).toBe(true)
    expect(hudIsVisible(makePhone({ callStatus: 'ringing' }))).toBe(true)
    expect(hudIsVisible(makePhone({ busy: true }))).toBe(true)
    expect(hudIsVisible(makePhone({ error: 'no line' }))).toBe(true)
  })
})

describe('pageCanDial', () => {
  // Panel 0 is on the classic page, panel 8 on the home page (see panels.ts).
  const img = (over: Partial<ImgTransform> = {}): ImgTransform => ({
    ...NEW_IMAGE,
    panel: 0,
    ...over,
  })
  const bubble = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
    ...NEW_BUBBLE,
    panel: 0,
    ...over,
  })

  it('is false for a page with neither a projected pad nor a phone balloon', () => {
    expect(pageCanDial([img()], [bubble({ content: 'text' })], 'classic')).toBe(false)
  })

  it('is true for a projected pad on the page', () => {
    expect(pageCanDial([img({ numberPad: newNumberPad() })], [], 'classic')).toBe(true)
  })

  it('is true for a phone balloon on the page, which is the pad’s fallback', () => {
    expect(pageCanDial([], [bubble({ content: 'phone' })], 'classic')).toBe(true)
  })

  it('is true for a dial balloon, which is that field with a shortlist behind it', () => {
    expect(pageCanDial([], [bubble({ content: 'dial' })], 'classic')).toBe(true)
  })

  it('ignores a dial balloon that is a chain slot', () => {
    expect(pageCanDial([], [bubble({ content: 'dial', chain: 'chain-1' })], 'classic')).toBe(false)
  })

  it('ignores a phone balloon that is a chain slot, since it dials nothing', () => {
    expect(pageCanDial([], [bubble({ content: 'phone', chain: 'chain-1' })], 'classic')).toBe(
      false,
    )
  })

  it('ignores both when they sit on the other page', () => {
    const elsewhere = [
      img({ panel: 0, numberPad: newNumberPad() }),
    ]
    expect(pageCanDial(elsewhere, [bubble({ panel: 0, content: 'phone' })], 'home')).toBe(false)
    expect(pageCanDial([], [bubble({ panel: 8, content: 'phone' })], 'home')).toBe(true)
  })
})

describe('PhoneHud', () => {
  it('groups the composed digits for reading without changing what is dialled', () => {
    const phone = makePhone({ dialTarget: '4155550123' })
    render(<PhoneHud phone={phone} />)

    // Grouped for the eye; `autoDial` still reads the raw dialTarget off the hook.
    expect(screen.getByText('(415) 555-0123')).toBeTruthy()
  })

  it('places the call through autoDial, which registers first when it has to', () => {
    const phone = makePhone({ dialTarget: '101' })
    render(<PhoneHud phone={phone} />)

    fireEvent.click(screen.getByRole('button', { name: 'Call' }))
    expect(phone.autoDial).toHaveBeenCalledTimes(1)
    // With no arguments: `autoDial` takes an optional number for callers that hold one
    // of their own, and a click event handed over as one would not be dialable.
    expect(phone.autoDial).toHaveBeenCalledWith()
    expect(phone.dial).not.toHaveBeenCalled()
  })

  it('will not call an empty number', () => {
    render(<PhoneHud phone={makePhone()} />)
    expect(screen.getByRole('button', { name: 'Call' })).toHaveProperty('disabled', true)
  })

  it('deletes the last digit', () => {
    const phone = makePhone({ dialTarget: '4155' })
    render(<PhoneHud phone={phone} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete the last digit' }))
    expect(phone.setDialTarget).toHaveBeenCalledWith('415')
  })

  it('offers answer and decline to an inbound call', () => {
    const phone = makePhone({ callStatus: 'ringing', remoteParty: '+14155550123' })
    render(<PhoneHud phone={phone} />)

    expect(screen.getByText('Incoming call from +14155550123')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }))
    expect(phone.answer).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(phone.decline).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Call' })).toBeNull()
  })

  it('offers hang up and mute once a call is up', () => {
    const phone = makePhone({ callStatus: 'active', remoteParty: '101' })
    render(<PhoneHud phone={phone} />)

    fireEvent.click(screen.getByRole('button', { name: 'Hang up' }))
    expect(phone.hangup).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(phone.toggleMute).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Call' })).toBeNull()
  })

  it('shows a registration failure rather than swallowing it', () => {
    render(<PhoneHud phone={makePhone({ error: 'No SIP WebSocket URL is configured' })} />)
    expect(screen.getByText('No SIP WebSocket URL is configured')).toBeTruthy()
  })
})
