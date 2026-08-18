// Speech-bubble type registry — the shared source of truth for which font each
// bubble "type" letters in. Imported by both the renderer (PanelBubble.tsx, prod)
// and the dev editor, so it ships in prod like layoutConfig.ts and transforms.ts.
//
// The outlines themselves are generated, not drawn: see bubbleShape.ts, which owns
// one shared vertex ring per type. Nothing here points at artwork any more, which
// is precisely what makes a shape change a morph instead of an image swap.

// There is deliberately no separate "shout" type. A spiky shout balloon and the
// action burst are the same drawing at different amplitudes, so two of them meant
// two entries nobody could tell apart in the editor dropdown; `lightning` is the
// one jagged shape, and loud lettering is what distinguishes a shout.
export type BubbleType = 'soft' | 'cloud' | 'lightning'

interface BubbleTypeDef {
  /** Canonical font for this bubble type — applied automatically on shape change. */
  font: string
  /** Human-readable label for the editor dropdown. */
  label: string
}

export const BUBBLE_TYPES: Record<BubbleType, BubbleTypeDef> = {
  soft: { font: 'Boogaloo', label: 'Speech (soft)' },
  cloud: { font: 'Permanent Marker', label: 'Thought (cloud)' },
  lightning: { font: 'Bangers', label: 'Action (lightning)' },
}

/** All bubble types in display order — for the editor dropdown. */
export const BUBBLE_TYPE_KEYS = Object.keys(BUBBLE_TYPES) as BubbleType[]
