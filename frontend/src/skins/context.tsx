import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Skin } from './types'
import { GRID_PAPER, runBenDayGrid } from './comic-book/benDayGrid'
import { accentForPath } from './comic-book/pageAccent'
import { skinLoaders, skinLoadingConfigs, DEFAULT_SKIN, resolveSkinName, SKIN_NAMES } from './registry'
import type { SkinName } from './registry'

// ── Comic-book skin: the loading screen its own chunk is not there to draw ───
//
// This screen and the skin's `LoadingOverlay` are the same screen: the Ben-Day grid
// from `comic-book/benDayGrid.ts` under the shared spotlight, with a legend on top. It
// has to be drawn from here because the chunk that would draw it is what the visitor is
// waiting for — so the grid modules are small, import nothing else from the skin, and
// are the only part of it on the eager path (`bundlePolicy.ts`).
//
// Before this, it ran a ripple of its own: a sine wave travelling the dot grid on a
// timer, which looked nothing like the still, pointer-lit grid the page hands over to,
// so the chunk landing read as the effect being swapped out mid-load.

function ComicBookLoadingScreen({ showCard }: { showCard: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [dotCount, setDotCount] = useState(1)

  // The route's own accent, so the grid does not change colour under the legend when the
  // skin takes over and colours it from the same function.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return runBenDayGrid(canvas, accentForPath(window.location.pathname))
  }, [])

  // Cycling dots 1 → 2 → 3 → 1…
  useEffect(() => {
    if (!showCard) return
    setDotCount(1)
    const id = setInterval(() => setDotCount(d => d === 3 ? 1 : d + 1), 450)
    return () => clearInterval(id)
  }, [showCard])

  return (
    <div style={{
      position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
      // The paper the grid prints on, so nothing shows through before the first frame.
      minHeight: '100vh', overflow: 'hidden', background: GRID_PAPER,
      // The skin's stylesheet is the chunk this screen is waiting for, so the drawn
      // pointer comes from the loading config rather than from `--cb-cursor-default`.
      cursor: skinLoadingConfigs['comic-book'].cursor,
      userSelect: 'none',
    }}>
      <style>{`
                @keyframes cb-ctx-pop {
                    0%   { transform: scale(0.35) rotate(-14deg); opacity: 0; }
                    60%  { transform: scale(1.10) rotate(3deg);   opacity: 1; }
                    80%  { transform: scale(0.96) rotate(-2deg); }
                    100% { transform: scale(1)    rotate(-3deg); }
                }
                @keyframes cb-ctx-bob {
                    from { transform: scale(1)    rotate(-3deg); box-shadow: 6px 6px 0 #111111; }
                    to   { transform: scale(1.04) rotate(-1deg); box-shadow: 9px 9px 0 #111111; }
                }
                .cb-ctx-dot { display: inline-block; transition: opacity 80ms step-start; }
            `}</style>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {showCard && (
        <span style={{
          position: 'relative', zIndex: 1,
          fontFamily: "'Bangers', cursive", fontSize: '48px', letterSpacing: '6px',
          color: '#111111', lineHeight: '1',
          background: '#FFE033', border: '4px solid #111111',
          padding: '12px 32px', display: 'inline-block',
          animation: 'cb-ctx-pop 450ms cubic-bezier(0.34, 1.56, 0.64, 1) both, cb-ctx-bob 1.1s ease-in-out 450ms infinite alternate',
        }}>
          LOADING
          <span aria-hidden="true">
            <span className="cb-ctx-dot" style={{ opacity: dotCount >= 1 ? 1 : 0 }}>.</span>
            <span className="cb-ctx-dot" style={{ opacity: dotCount >= 2 ? 1 : 0 }}>.</span>
            <span className="cb-ctx-dot" style={{ opacity: dotCount >= 3 ? 1 : 0 }}>.</span>
          </span>
        </span>
      )}
    </div>
  )
}

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
  const [showLoader, setShowLoader] = useState(false)

  // Keep body background in sync with the current skin's theme color so there's
  // no white flash in the gap between the loading overlay unmounting and the
  // skin's Layout painting its own background.
  useEffect(() => {
    document.body.style.background = skinLoadingConfigs[skinName].background
  }, [skinName])

  useEffect(() => {
    setSkin(null)
    setShowLoader(false)

    // Only reveal the loading UI after 200 ms — fast / cached loads finish
    // before the timer fires and the loading screen never appears at all.
    const loaderTimer = setTimeout(() => setShowLoader(true), 200)

    skinLoaders[skinName]().then((m) => {
      clearTimeout(loaderTimer)
      setSkin(m.default)
    })

    return () => clearTimeout(loaderTimer)
  }, [skinName])

  const switchSkin = useCallback((name: SkinName) => {
    localStorage.setItem('skin', name)
    setSkinName(name)
  }, [])

  if (!skin) {
    if (skinName === 'comic-book') {
      return <ComicBookLoadingScreen showCard={showLoader} />
    }
    const cfg = skinLoadingConfigs[skinName]
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: cfg.background,
          backgroundImage: cfg.backgroundImage,
          backgroundSize: cfg.backgroundSize,
          cursor: cfg.cursor,
          userSelect: 'none',
        }}
      >
        {/* Only show the loading indicator after the debounce — fast / cached
            loads finish before it fires so the UI never flashes. */}
        {showLoader && (
          cfg.card ? (
            <div
              style={{
                border: cfg.card.border,
                boxShadow: cfg.card.boxShadow,
                background: cfg.card.background,
                padding: cfg.card.padding,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <span style={cfg.textStyle}>{cfg.text}</span>
              {cfg.subtext && <span style={cfg.subtextStyle}>{cfg.subtext}</span>}
            </div>
          ) : (
            <span style={cfg.textStyle}>{cfg.text}</span>
          )
        )}
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
