/** The five ways a panel bubble can present its authored text. */
export type BubbleContentKind = 'text' | 'wheel' | 'input' | 'phone' | 'dial'

export const BUBBLE_CONTENT_KINDS: BubbleContentKind[] = [
  'text',
  'wheel',
  'input',
  'phone',
  'dial',
]

/** Runtime guard for persisted payloads, mirroring isBubbleType / isTailDir. */
export function isBubbleContentKind(value: unknown): value is BubbleContentKind {
  return typeof value === 'string' && (BUBBLE_CONTENT_KINDS as string[]).includes(value)
}

/**
 * The panel's dial balloon — a wheel picker whose current option is also a real phone
 * field — or -1 when the panel has none.
 *
 * Same exclusion as {@link peerPickerOn}: a balloon inside a chain is picking what to
 * *say*, so it is not the panel's number. The first free one wins, because a panel dials
 * one number at a time — which is also why a panel's dialled value is one value, shared
 * by however many dial balloons the author drew on it, and why the projected keypad on
 * the same panel has somewhere unambiguous to type.
 */
export function dialBubbleOn(
  bubbles: readonly { panel: number; chain: string; content: string }[],
  panel: number,
): number {
  return bubbles.findIndex(b => b.panel === panel && b.chain === '' && b.content === 'dial')
}
