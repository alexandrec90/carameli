import { useState, useEffect } from 'react'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export function useAuth() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    async function init() {
      // Already have a valid session?
      const me = await fetch(`${BASE}/auth/me`, { credentials: 'include' })
      if (me.ok) {
        setReady(true)
        return
      }
      // No session — auto-acquire one
      await fetch(`${BASE}/auth/session`, {
        method: 'POST',
        credentials: 'include',
      })
      setReady(true)
    }
    init()
  }, [])

  return { ready }
}
