/**
 * The nine ways a panel bubble can present its authored text.
 *
 * 'transcript' and 'number-hangup' are the two that present something *else*: the words,
 * or the number, come from the call on the balloon's panel and its own `text` is ignored.
 * They are here rather than in components of their own because everything else about them
 * is an ordinary balloon — a shape, a tail, a place on the panel, all of it draggable — and
 * a call's words are worth no less.
 */
export type BubbleContentKind =
  | 'text'
  | 'wheel'
  | 'input'
  | 'phone'
  | 'dial'
  | 'dial-call'
  | 'actions'
  | 'transcript'
  | 'number-hangup'

export const BUBBLE_CONTENT_KINDS: BubbleContentKind[] = [
  'text',
  'wheel',
  'input',
  'phone',
  'dial',
  'dial-call',
  'actions',
  'transcript',
  'number-hangup',
]

/**
 * True for a kind that draws one of the telephone's keys and so takes the handset's
 * handlers: the lettered `actions` row, and the number-with-red-key balloon. A `dial-call`
 * is not one — its green key places the call through the dial's own submit, not through
 * a handler, because the number it dials is the field's rather than the phone's.
 */
export function takesPhoneActions(content: string): boolean {
  return content === 'actions' || content === 'number-hangup'
}

/**
 * True for either dial: the drum-with-a-field, and the same balloon with the telephone's
 * green key beside that field ('dial-call').
 *
 * The key is the *whole* difference between them, so every other question a panel asks
 * about a dial — is this the balloon the projected keypad types into, the one an SMS
 * chain takes its peer from, what does it claim of the panel's keyboard — has the same
 * answer for both. They ask through here rather than each spelling out a two-way
 * comparison, so adding a third dial is one edit instead of six.
 */
export function isDialContent(content: string): boolean {
  return content === 'dial' || content === 'dial-call'
}

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
  return bubbles.findIndex(b => b.panel === panel && b.chain === '' && isDialContent(b.content))
}
