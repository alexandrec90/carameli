import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { Skin } from './types'
import { GRID_PAPER, runBenDayGrid } from './comic-book/benDayGrid'
import { accentForPath } from './comic-book/pageAccent'
import { useLoadingHeld } from '../hooks/useLoadingHold'
import { slowLoad, slowLoaderDelay } from '../lib/slowLoading'
import { skinLoaders, skinLoadingConfigs, DEFAULT_SKIN, resolveSkinName, SKIN_NAMES } from './registry'
import type { SkinName } from './registry'

// ── Comic-book skin: the paper the page is printed on ────────────────────────
//
// The comic-book loading screen is the skin's paper: the Ben-Day grid from
// `comic-book/benDayGrid.ts` under the shared pointer spotlight, with a legend on top
// while anything is still loading. It is mounted here, under the app, for the skin's
// whole life — never by the skin. Three things load one after another (this chunk, the
// session in `App.tsx`, the page's pictures in `comic-book/Layout.tsx`), and a screen
// drawn per gate was three screens: each popped a legend of its own, re-lit a grid of
// its own, and left a bare frame between them. Now the grid is one canvas that outlives
// all three, the gates below say what is still loading through
// `hooks/useLoadingHold.ts`, and the page wipes in over the paper once its pictures are
// in (`comic-book/pageReveal.ts`), leaving the grid showing in the letterbox around it.
//
// The grid has to be drawn from here because the chunk that would otherwise draw it is
// what the visitor is waiting for — so the grid modules are small, import nothing else
// from the skin, and are the only part of it on the eager path (`bundlePolicy.ts`).

/** How long something has to be loading before the legend appears; 0 under `?slow=1`. */
export const LEGEND_DELAY_MS = 200

/**
 * How long the legend stays after the last hold goes. Zero, and a timer all the same:
 * one gate opens in the render that mounts the next, whose hold is counted in that
 * commit's layout phase and re-renders this before the timer can fire, so the legend
 * carries across the handoff instead of coming down and popping up again.
 */
export const LEGEND_LINGER_MS = 0

/** Cycling dots after the legend, 1 → 2 → 3 → 1…, while `active`. */
function useDotCycle(active: boolean): number {
  const [dotCount, setDotCount] = useState(1)
  useEffect(() => {
    if (!active) return
    setDotCount(1)
    const id = setInterval(() => setDotCount(d => d === 3 ? 1 : d + 1), 450)
    return () => clearInterval(id)
  }, [active])
  return dotCount
}

function ComicBookPaper({ loading }: { loading: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const { pathname } = useLocation()
  const cfg = skinLoadingConfigs['comic-book']

  // Inked in the route's own accent, re-inked when the route changes, so the grid the
  // page-transition wash reveals in the letterbox is the new page's.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return runBenDayGrid(canvas, accentForPath(pathname))
  }, [pathname])

  const [legend, setLegend] = useState(false)
  useEffect(() => {
    const timer = loading
      ? setTimeout(() => setLegend(true), slowLoaderDelay(LEGEND_DELAY_MS))
      : setTimeout(() => setLegend(false), LEGEND_LINGER_MS)
    return () => clearTimeout(timer)
  }, [loading])
  const dotCount = useDotCycle(legend)

  return (
    <div style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // The paper the grid prints on, so nothing shows through before the first frame.
      background: GRID_PAPER,
      // The skin's stylesheet may not be here yet, so the drawn pointer comes from the
      // loading config rather than from `--cb-cursor-default`.
      cursor: cfg.cursor,
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
      {legend && (
        <span aria-live="polite" style={{
          position: 'relative', display: 'inline-block',
          ...cfg.textStyle, ...cfg.card,
          animation: 'cb-ctx-pop 450ms cubic-bezier(0.34, 1.56, 0.64, 1) both, cb-ctx-bob 1.1s ease-in-out 450ms infinite alternate',
        }}>
          {cfg.text}
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
  const held = useLoadingHeld()

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
    // before the timer fires and the loading screen never appears at all. `?slow=1`
    // drops the debounce and holds the chunk for a second, which is that same sentence
    // turned into the reason you cannot see this screen when you want to (dev only).
    const loaderTimer = setTimeout(() => setShowLoader(true), slowLoaderDelay(200))

    slowLoad(skinLoaders[skinName]()).then((m) => {
      clearTimeout(loaderTimer)
      setSkin(m.default)
    })

    return () => clearTimeout(loaderTimer)
  }, [skinName])

  const switchSkin = useCallback((name: SkinName) => {
    localStorage.setItem('skin', name)
    setSkinName(name)
  }, [])

  const cfg = skinLoadingConfigs[skinName]
  // A persistent screen is up for the skin's life, under the page, and is told what is
  // still loading: this chunk until it lands, then whatever holds below.
  const paper = cfg.persistent ? <ComicBookPaper loading={!skin || held} /> : null

  if (!skin) {
    if (paper) return paper
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
    <>
      {paper}
      <SkinContext.Provider value={{ skin, skinName, switchSkin }}>
        {children}
      </SkinContext.Provider>
    </>
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
