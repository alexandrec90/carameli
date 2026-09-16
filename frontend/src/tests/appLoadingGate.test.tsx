import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The session gate in `App`. On a skin with a persistent loading screen it draws
// nothing — the screen is already up beneath it — and holds that screen instead; on
// every other skin it draws the skin's loading config as before.

const auth = vi.hoisted(() => ({ ready: false }))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ ready: auth.ready }),
  startSession: () => Promise.resolve(),
}))

import App from '../App'
import { isLoadingHeld } from '../hooks/useLoadingHold'
import { skinLoadingConfigs } from '../skins/registry'

beforeEach(() => {
  auth.ready = false
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

function renderApp() {
  return render(<MemoryRouter><App /></MemoryRouter>)
}

describe('the session gate', () => {
  it('draws nothing and holds the persistent screen on the comic-book skin', () => {
    localStorage.setItem('skin', 'comic-book')
    expect(skinLoadingConfigs['comic-book'].persistent).toBe(true)

    const { container } = renderApp()
    act(() => { vi.advanceTimersByTime(1000) })

    expect(container.innerHTML).toBe('')
    expect(isLoadingHeld()).toBe(true)
  })

  it('draws the skin\'s own screen on a skin without one', () => {
    localStorage.setItem('skin', 'barebone')
    expect(skinLoadingConfigs.barebone.persistent).toBeUndefined()

    const { container } = renderApp()
    act(() => { vi.advanceTimersByTime(1000) })

    expect(container.innerHTML).not.toBe('')
    expect(screen.getByText(skinLoadingConfigs.barebone.text)).not.toBeNull()
  })

  it('releases the hold once the session is in', () => {
    localStorage.setItem('skin', 'comic-book')
    const view = renderApp()
    expect(isLoadingHeld()).toBe(true)
    view.unmount()
    expect(isLoadingHeld()).toBe(false)
  })
})
