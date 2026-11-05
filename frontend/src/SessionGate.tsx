import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { useAuth } from './hooks/useAuth'
import { useLoadingHold } from './hooks/useLoadingHold'
import { useSlowReady } from './hooks/useSlowLoading'
import { slowLoaderDelay } from './lib/slowLoading'
import { skinLoadingConfigs, resolveSkinName, DEFAULT_SKIN } from './skins/registry'

// 0 on first visit (nothing cached — will be slow), 400 on return visits (likely cached),
// and 0 again under `?slow=1`, which is here to make this screen visible.
const LOADER_DELAY = slowLoaderDelay(localStorage.getItem('app:loaded') ? 400 : 0)

/** Holds a live build's app behind the session request. The demo has no session. */
export function SessionGate({ children }: { children: ReactNode }) {
  const { ready: sessionReady } = useAuth()
  // `?slow=1` holds this gate shut for a second after the session arrives (dev only, no-op
  // otherwise), so the screen below is on screen long enough to look at.
  const ready = useSlowReady(sessionReady)
  // A persistent loading screen (`skins/registry.ts`) is already up under this, and is
  // told through the hold that the session is still on its way. Every other skin's
  // screen is drawn below; nothing listens to the hold then, and it costs nothing.
  useLoadingHold(!ready)
  const [showLoader, setShowLoader] = useState(false)

  useEffect(() => {
    if (ready) { localStorage.setItem('app:loaded', '1'); return }
    const t = setTimeout(() => setShowLoader(true), LOADER_DELAY)
    return () => clearTimeout(t)
  }, [ready])

  if (ready) return children

  const skinName = resolveSkinName(localStorage.getItem('skin') ?? DEFAULT_SKIN)
  const cfg = skinLoadingConfigs[skinName]
  if (cfg.persistent) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh',
      background: cfg.background,
      backgroundImage: cfg.backgroundImage,
      backgroundSize: cfg.backgroundSize,
      // A loading screen is a picture, not a document: it wears the skin's own
      // pointer (inherited by everything on it) and its legend does not highlight.
      cursor: cfg.cursor,
      userSelect: 'none',
    }}>
      {showLoader && (cfg.card ? (
        <div style={{
          border: cfg.card.border, boxShadow: cfg.card.boxShadow,
          background: cfg.card.background, padding: cfg.card.padding,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}>
          <span style={cfg.textStyle}>{cfg.text}</span>
        </div>
      ) : (
        <span style={cfg.textStyle}>{cfg.text}</span>
      ))}
    </div>
  )
}
