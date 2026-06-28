// Speech-bubble type registry — the shared source of truth for which bubble
// artwork + font each bubble "type" maps to. Imported by both the renderer
// (Layout.tsx, prod) and the dev editor, so it ships in prod like layoutConfig.ts
// and transforms.ts. Assets live in public/comic-book/ (see skin-comic-book rule).

export type BubbleType = 'soft' | 'cloud' | 'lightning' | 'jagged'

interface BubbleTypeDef {
  /** Bubble artwork in public/comic-book/ (URL-encoded space). */
  src: string
  /** Canonical font for this bubble type — applied automatically on type change. */
  font: string
  /** Human-readable label for the editor dropdown. */
  label: string
}

export const BUBBLE_TYPES: Record<BubbleType, BubbleTypeDef> = {
  soft: { src: '/comic-book/soft%20bubble.webp', font: 'Boogaloo', label: 'Speech (soft)' },
  cloud: { src: '/comic-book/cloud%20bubble.webp', font: 'Permanent Marker', label: 'Thought (cloud)' },
  lightning: { src: '/comic-book/lightning%20bubble.webp', font: 'Bangers', label: 'Action (lightning)' },
  jagged: { src: '/comic-book/jagged%20bubble.webp', font: 'Fugaz One', label: 'Shout (jagged)' },
}

/** All bubble types in display order — for the editor dropdown. */
export const BUBBLE_TYPE_KEYS = Object.keys(BUBBLE_TYPES) as BubbleType[]
