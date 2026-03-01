import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Skin } from './types'
import { skinLoaders, DEFAULT_SKIN, resolveSkinName, SKIN_NAMES } from './registry'
import type { SkinName } from './registry'

interface SkinContextValue {
  skin: Skin
  skinName: SkinName
  switchSkin: (name: SkinName) => void
}

const SkinContext = createContext<SkinContextValue | null>(null)

export function SkinProvider({ children }: { children: React.ReactNode }) {
  const [skinName, setSkinName] = useState<SkinName>(
    () => resolveSkinName(localStorage.getItem('skin') ?? DEFAULT_SKIN)
  )
  const [skin, setSkin] = useState<Skin | null>(null)

  useEffect(() => {
    setSkin(null)
    skinLoaders[skinName]().then((m) => setSkin(m.default))
  }, [skinName])

  const switchSkin = useCallback((name: SkinName) => {
    localStorage.setItem('skin', name)
    setSkinName(name)
  }, [])

  if (!skin) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: '#1A0F00',
          color: '#FF9F1C',
          fontFamily: 'sans-serif',
          opacity: 0.7,
        }}
      >
        Loading…
      </div>
    )
  }

  return (
    <SkinContext.Provider value={{ skin, skinName, switchSkin }}>
      {children}
    </SkinContext.Provider>
  )
}

export function useSkin(): Skin {
  const ctx = useContext(SkinContext)
  if (!ctx) throw new Error('useSkin must be used within SkinProvider')
  return ctx.skin
}

export function useSkinSwitcher(): { skinName: SkinName; switchSkin: (name: SkinName) => void; skinNames: typeof SKIN_NAMES } {
  const ctx = useContext(SkinContext)
  if (!ctx) throw new Error('useSkinSwitcher must be used within SkinProvider')
  return { skinName: ctx.skinName, switchSkin: ctx.switchSkin, skinNames: SKIN_NAMES }
}
