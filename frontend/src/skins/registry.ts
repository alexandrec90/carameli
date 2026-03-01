import type { Skin } from './types'

export const SKIN_NAMES = ['carameli', 'candy-shop'] as const
export type SkinName = typeof SKIN_NAMES[number]

// Each entry is a dynamic import — Vite splits each skin into its own chunk.
// Heavy deps (Three.js, etc.) only ship to users of the skin that imports them.
export const skinLoaders: Record<SkinName, () => Promise<{ default: Skin }>> = {
  carameli: () => import('./carameli'),
  'candy-shop': () => import('./candy-shop'),
}

export const DEFAULT_SKIN: SkinName = 'carameli'

export function resolveSkinName(name: string): SkinName {
  return (SKIN_NAMES as readonly string[]).includes(name)
    ? (name as SkinName)
    : DEFAULT_SKIN
}
