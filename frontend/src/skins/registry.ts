import React from 'react'
import type { Skin } from './types'

export const SKIN_NAMES = ['carameli', 'candy-shop', 'barebone', 'comic-book'] as const
export type SkinName = typeof SKIN_NAMES[number]

// Each entry is a dynamic import — Vite splits each skin into its own chunk, so a
// skin's code and its dependencies reach only the visitors who load that skin.
// `bundlePolicy.test.ts` asserts the split still happens: a static import anywhere on
// the entry path silently undoes it, and nothing else here would notice.
export const skinLoaders: Record<SkinName, () => Promise<{ default: Skin }>> = {
  carameli: () => import('./carameli'),
  'candy-shop': () => import('./candy-shop'),
  barebone: () => import('./barebone'),
  'comic-book': () => import('./comic-book'),
}

export interface SkinLoadingConfig {
  /** Outer wrapper background (CSS value) */
  background: string
  /** Optional CSS backgroundImage (e.g. Ben-Day dots) */
  backgroundImage?: string
  /** Optional CSS backgroundSize */
  backgroundSize?: string
  /** Panel/card element, or null to skip the card */
  card?: {
    background: string
    border: string
    boxShadow: string
    padding: string
  }
  text: string
  textStyle: React.CSSProperties
  subtext?: string
  subtextStyle?: React.CSSProperties
  /** CSS `cursor` for the whole loading screen, inherited by everything on it.
      A loading screen renders *before* its skin's chunk — and therefore before that
      skin's stylesheet and any custom property it defines — so a skin whose pointer is
      drawn artwork has to spell the url and hotspot out here rather than name a token.
      `loadingScreen.test.tsx` keeps this in step with `--cb-cursor-default`. */
  cursor?: string
  /** The screen outlives the load: `SkinProvider` keeps it mounted under the app for
      the skin's whole life, and the gates below it — the session in `App.tsx`, a page's
      pictures — say what is still loading through `hooks/useLoadingHold.ts` instead of
      drawing a screen of their own. One legend spans every gate, where one screen per
      gate was three legends popping in turn with a bare frame between them. */
  persistent?: boolean
}

export const skinLoadingConfigs: Record<SkinName, SkinLoadingConfig> = {
  carameli: {
    background: '#1A0F00',
    text: 'Loading…',
    textStyle: { fontFamily: 'sans-serif', fontSize: '18px', color: '#FF9F1C', opacity: 0.7 },
  },
  'candy-shop': {
    background: '#1A0F00',
    text: 'Loading…',
    textStyle: { fontFamily: 'sans-serif', fontSize: '18px', color: '#FF9F1C', opacity: 0.7 },
  },
  barebone: {
    background: '#ffffff',
    text: 'Loading…',
    textStyle: { fontFamily: 'sans-serif', fontSize: '18px', color: '#333' },
  },
  // The paper (`skins/context.tsx`): the Ben-Day grid on a canvas, with this card as the
  // legend on top while anything loads. `background` is the paper under the canvas's
  // first frame; the trailing dots are drawn by the screen, cycling, so `text` has none.
  'comic-book': {
    persistent: true,
    background: '#FAFAF2',
    card: {
      background: '#FFE033',
      border: '4px solid #111111',
      boxShadow: '6px 6px 0 #111111',
      padding: '12px 32px',
    },
    text: 'LOADING',
    textStyle: { fontFamily: "'Bangers', cursive", fontSize: '48px', letterSpacing: '6px', color: '#111111', lineHeight: '1' },
    cursor: "url('/comic-book/pointer-cursor.webp') 2 1, default",
  },
}

export const DEFAULT_SKIN: SkinName = 'comic-book'

export function resolveSkinName(name: string): SkinName {
  return (SKIN_NAMES as readonly string[]).includes(name)
    ? (name as SkinName)
    : DEFAULT_SKIN
}
