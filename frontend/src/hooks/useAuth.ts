import { useState, useEffect } from 'react'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export function useAuth() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    async function init() {
      try {
        // Already have a valid session?
        const me = await fetch(`${BASE}/auth/me`, { credentials: 'include' })
        if (!me.ok) {
          // No session — auto-acquire one
          await fetch(`${BASE}/auth/session`, {
            method: 'POST',
            credentials: 'include',
          })
        }
      } catch {
        // Backend unreachable — allow the UI to render anyway (API calls
        // inside hooks will fail gracefully with empty/error states).
      } finally {
        setReady(true)
      }
    }
    init()
  }, [])

  return { ready }
}
