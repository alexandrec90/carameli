import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAuth } from '../../hooks/useAuth'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useAuth', () => {
  it('starts with ready=false while auth session request is in-flight', () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)

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

    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith('/auth/session', {
      method: 'POST',
      credentials: 'include',
    })
  })
})
