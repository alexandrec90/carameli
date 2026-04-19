import React from 'react'
import type { Skin } from './types'

export const SKIN_NAMES = ['carameli', 'candy-shop', 'barebone', 'comic-book'] as const
export type SkinName = typeof SKIN_NAMES[number]

// Each entry is a dynamic import — Vite splits each skin into its own chunk.
// Heavy deps (Three.js, etc.) only ship to users of the skin that imports them.
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
  'comic-book': {
    background: '#FAFAF2',
    backgroundImage: 'radial-gradient(circle, #FFE033 1.5px, transparent 1.5px)',
    backgroundSize: '12px 12px',
    card: {
      background: '#FFE033',
      border: '4px solid #111111',
      boxShadow: '6px 6px 0 #111111',
      padding: '32px 48px',
    },
    text: 'LOADING...',
    textStyle: { fontFamily: "'Bangers', cursive", fontSize: '52px', letterSpacing: '4px', color: '#111111', lineHeight: '1' },
  },
}

export const DEFAULT_SKIN: SkinName = 'comic-book'

export function resolveSkinName(name: string): SkinName {
  return (SKIN_NAMES as readonly string[]).includes(name)
    ? (name as SkinName)
    : DEFAULT_SKIN
}
