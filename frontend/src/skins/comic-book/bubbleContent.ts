/** The four ways a panel bubble can present its authored text. */
export type BubbleContentKind = 'text' | 'wheel' | 'input' | 'phone'

export const BUBBLE_CONTENT_KINDS: BubbleContentKind[] = [
  'text',
  'wheel',
  'input',
  'phone',
]

/** Runtime guard for persisted payloads, mirroring isBubbleType / isTailDir. */
export function isBubbleContentKind(value: unknown): value is BubbleContentKind {
  return typeof value === 'string' && (BUBBLE_CONTENT_KINDS as string[]).includes(value)
}
