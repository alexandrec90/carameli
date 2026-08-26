import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { UseSoftphoneResult } from '../../hooks/useSoftphone'
import PhoneHud, { hudIsVisible } from '../../skins/comic-book/PhoneHud'

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
