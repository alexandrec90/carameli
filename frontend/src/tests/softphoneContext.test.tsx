import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useSoftphoneMock = vi.fn()

vi.mock('../hooks/useSoftphone', () => ({
  useSoftphone: () => useSoftphoneMock(),
}))

import { SoftphoneProvider, useSharedSoftphone } from '../hooks/softphoneContext'

function Consumer({ id }: { id: string }) {
  const phone = useSharedSoftphone()
  return <span data-testid={id}>{phone.registeredAs}</span>
}

beforeEach(() => {
  useSoftphoneMock.mockReset()
  let calls = 0
  useSoftphoneMock.mockImplementation(() => {
    calls += 1
    return { registeredAs: `instance-${calls}` }
  })
})

describe('SoftphoneProvider', () => {
  it('gives every consumer the same phone', () => {
    render(
      <SoftphoneProvider>
        <Consumer id="a" />
        <Consumer id="b" />
      </SoftphoneProvider>,
    )

    // Not cosmetic: a second `useSoftphone()` is a second SIP registration on the same
    // extension, and the SBC then forks an inbound call to both.
    expect(useSoftphoneMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('a').textContent).toBe('instance-1')
    expect(screen.getByTestId('b').textContent).toBe('instance-1')
  })

  it('refuses to register a phone outside the provider', () => {
    // React logs the thrown error; the assertion is that it throws rather than
    // silently minting a second registration.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Consumer id="lone" />)).toThrow(/SoftphoneProvider/)
    quiet.mockRestore()
  })
})
