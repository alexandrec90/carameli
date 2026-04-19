import { useState, useEffect } from 'react'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export function useAuth() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Acquire or refresh a session before the app renders authenticated views.
    // POST /auth/session is idempotent and requires no existing credentials
    // (network-level trust model). Calling it directly avoids the GET /auth/me
    // probe which always returns 401 on first load and triggers a browser
    // "Failed to load resource" console error that breaks E2E smoke tests.
    fetch(`${BASE}/auth/session`, {
      method: 'POST',
      credentials: 'include',
    }).finally(() => {
      setReady(true)
    })
  }, [])

  return { ready }
}
