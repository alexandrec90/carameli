import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Skin } from './types'
import { skinLoaders, skinLoadingConfigs, DEFAULT_SKIN, resolveSkinName, SKIN_NAMES } from './registry'
import type { SkinName } from './registry'

// ── Comic-book skin: animated loading screen ────────────────────────────────

function drawComicLoadingBg(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = '#FAFAF2'
  ctx.fillRect(0, 0, w, h)
  const spacing = 20
  const baseR = 4.5
  const waveLen = 260
  const waveSpeed = 0.55
  for (let x = spacing / 2; x < w; x += spacing) {
    for (let y = spacing / 2; y < h; y += spacing) {
      const phase = ((x + y) / waveLen) * Math.PI * 2 - t * waveSpeed * Math.PI * 2
      const t01 = (Math.sin(phase) + 1) / 2
      const alpha = 0.12 + 0.68 * t01
      ctx.fillStyle = `rgba(255,224,51,${alpha.toFixed(2)})`
      ctx.beginPath()
      ctx.arc(x, y, Math.max(0.3, baseR * (0.12 + 0.88 * t01)), 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function ComicBookLoadingScreen({ showCard }: { showCard: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number>(0)
  const [dotCount, setDotCount] = useState(1)

  // Background ripple — starts immediately so it's already moving when card pops in
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
    resize()
    window.addEventListener('resize', resize)
    const loop = () => {
      const ctx = canvas.getContext('2d')
      if (ctx) drawComicLoadingBg(ctx, canvas.width, canvas.height, performance.now() / 1000)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(rafRef.current) }
  }, [])

  // Cycling dots 1 → 2 → 3 → 1…
  useEffect(() => {
    if (!showCard) return
    setDotCount(1)
    const id = setInterval(() => setDotCount(d => d === 3 ? 1 : d + 1), 450)
    return () => clearInterval(id)
  }, [showCard])

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', overflow: 'hidden', background: '#FAFAF2' }}>
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
          fontFamily: "'Bangers', cursive", fontSize: '52px', letterSpacing: '4px',
          color: '#111111', lineHeight: '1',
          background: '#FFE033', border: '4px solid #111111',
          padding: '32px 48px', display: 'inline-block',
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
