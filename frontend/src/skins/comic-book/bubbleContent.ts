/** The five ways a panel bubble can present its authored text. */
export type BubbleContentKind = 'text' | 'wheel' | 'input' | 'phone' | 'actions'

export const BUBBLE_CONTENT_KINDS: BubbleContentKind[] = [
  'text',
  'wheel',
  'input',
  'phone',
  'actions',
]

/** Runtime guard for persisted payloads, mirroring isBubbleType / isTailDir. */
export function isBubbleContentKind(value: unknown): value is BubbleContentKind {
  return typeof value === 'string' && (BUBBLE_CONTENT_KINDS as string[]).includes(value)
}
