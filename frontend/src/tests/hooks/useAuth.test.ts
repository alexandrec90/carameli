import { StrictMode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The session request is memoized in module scope, so each test loads its own copy of the
 * module rather than sharing one attempt across the file. That is the very property being
 * tested — one request per page, not one per mount — and a static import here would leave
 * every test after the first asserting against the first one's promise.
 */
async function loadAuth() {
  vi.resetModules()
  return import('../../hooks/useAuth')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useAuth', () => {
  it('starts with ready=false while auth session request is in-flight', async () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const { useAuth } = await loadAuth()

    const { result } = renderHook(() => useAuth())

    expect(result.current.ready).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith('/auth/session', {
      method: 'POST',
      credentials: 'include',
    })
  })

  it('transitions to ready=true after successful session setup', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { useAuth } = await loadAuth()

    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith('/auth/session', {
      method: 'POST',
      credentials: 'include',
    })
  })

  it('transitions to ready=true when session endpoint returns non-OK', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)
    const { useAuth } = await loadAuth()

    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith('/auth/session', {
      method: 'POST',
      credentials: 'include',
    })
  })

  it('transitions to ready=true when the session request fails outright', async () => {
    // A rejected fetch is a network-level failure, not a 500. The app still renders: the
    // API surfaces its own 401s, and a loading screen that never clears is worse than an
    // unauthenticated page that says so.
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    const { useAuth } = await loadAuth()

    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.ready).toBe(true))
  })

  it('issues one request under StrictMode, which double-invokes effects', async () => {
    // The reported symptom was a doubled `POST /auth/session` on every dev load, read at
    // the time as StrictMode noise. StrictMode was reporting something true: the effect
    // had no cleanup and was not safe to run twice, so two POSTs raced to set the session
    // cookie. Joining the in-flight promise is what the effect should always have done.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { useAuth } = await loadAuth()

    const { result } = renderHook(() => useAuth(), { wrapper: StrictMode })

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('starts the request without rendering, so it can overlap the skin load', async () => {
    // This is the whole point of the request living outside the component tree, and it is
    // why the export exists: `SkinProvider` does not render its children until the skin's
    // chunk has executed, so a fetch reachable only from a hook inside `App` cannot begin
    // until the skin has finished — two independent waits taken in series. `main.tsx`
    // calls this before `createRoot().render()`. If it ever becomes render-gated again,
    // this test is what says so.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { startSession } = await loadAuth()

    await startSession()

    expect(fetchMock).toHaveBeenCalledWith('/auth/session', {
      method: 'POST',
      credentials: 'include',
    })
  })

  it('joins the in-flight attempt rather than starting a second one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { startSession, useAuth } = await loadAuth()

    const primed = startSession()
    const { result } = renderHook(() => useAuth())
    await primed

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries after a network-level failure instead of inheriting the dead attempt', async () => {
    // Memoizing forever would mean one offline moment at load kept the page sessionless
    // for as long as it stayed open. A rejection drops the memo; a resolved response,
    // whatever its status, is an answer and is kept.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { startSession } = await loadAuth()

    await startSession()
    await startSession()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
