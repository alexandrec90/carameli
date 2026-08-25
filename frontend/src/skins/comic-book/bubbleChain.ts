// A bubble *chain* is a column of balloons an author drew by hand, read as one
// speaker's SMS thread: the lowest balloon is the root — the one with the tail, the one
// growing out of the character's mouth — and each one above it is a later message.
//
// Two behaviours ride on that column, and both are per-chain toggles rather than
// skin-wide policy, because a page can want a plain multi-balloon utterance (what
// connector tubes already do) beside a live thread:
//
//   grow   — the chain arrives one balloon at a time instead of all at once.
//   scroll — the transcript may be longer than the column, and the wheel moves a
//            window over it, each message sliding into the slot below the one it was in.
//
// The *slots* are the author's drawing and never move; the *messages* move through them.
// That separation is the whole design. It means an author draws three balloons in the
// editor, tunes their placement, rotation and shape as usual, and the thread then runs
// through those three shapes however many messages it holds — rather than the code
// having to invent a fourth balloon's geometry, which it has no way to make look drawn.
//
// Everything here is pure and vertical-only: slot order is decided by `top` alone, so a
// chain that wanders sideways still stacks bottom-to-top in message order. PanelBubbleChain.tsx
// is the DOM shell over these, the way BubbleWheel.tsx is over wheelPicker.ts.

/** Per-chain behaviour, keyed by the `chain` name its member bubbles carry. */
export interface BubbleChain {
  /** The name bubbles join by. Non-empty; '' on a bubble means "not in a chain". */
  id: string
  /**
   * Reveal the column one balloon at a time, root first, instead of all at once.
   * False renders every drawn slot together — what a chain of bubbles did before
   * chains existed.
   */
  grow: boolean
  /**
   * Let the mouse wheel move the window over a transcript longer than the column.
   * False pins the window at the newest messages the drawn slots can hold.
   */
  scroll: boolean
  /** Delay between balloons while growing, in ms. */
  stepMs: number
  /**
   * The thread. Empty means the chain speaks the slots' own `text`, in slot order —
   * which is what a chain that only wants the growth animation wants, and keeps the
   * words being edited where every other bubble's words are edited.
   */
  messages: string[]
}

/** Bounds for the growth delay, shared by the inspector's number field and hydration. */
export const CHAIN_STEP_MS = { min: 120, max: 5000, step: 20 }

/** Growth delay for a chain that does not name one. */
export const DEFAULT_CHAIN_STEP_MS = 900

/**
 * What a chain id with no entry in the config means: a plain column, revealed whole,
 * saying what its balloons say. That is deliberately the *inert* default — a hand-edited
 * `layoutConfig.ts` that names a chain on two bubbles and forgets the chain entry gets
 * the behaviour those bubbles had before they were named, not a surprise animation.
 */
export function defaultChain(id: string): BubbleChain {
  return { id, grow: false, scroll: false, stepMs: DEFAULT_CHAIN_STEP_MS, messages: [] }
}

/** Runtime guard for a persisted chain entry, mirroring isBubbleType / isTailDir. */
export function isBubbleChain(value: unknown): value is BubbleChain {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<BubbleChain>
  return (
    typeof c.id === 'string' &&
    c.id.length > 0 &&
    typeof c.grow === 'boolean' &&
    typeof c.scroll === 'boolean' &&
    typeof c.stepMs === 'number' &&
    Number.isFinite(c.stepMs) &&
    Array.isArray(c.messages) &&
    c.messages.every(m => typeof m === 'string')
  )
}

/** One member of a chain, as far as the ordering is concerned. */
interface ChainMember {
  chain: string
  panel: number
  top: number
}

/**
 * The bubbles of chain `id` on `panel`, as indices into `bubbles`, in **slot order**:
 * slot 0 first, which is the lowest balloon on the panel and so the root.
 *
 * Order comes from `top` and nothing else. Only vertical chains are supported, so the
 * author's own placement *is* the ordering — there is no separate index to keep in step
 * with a drag, and dragging a balloon past its neighbour reorders the chain, which is
 * the only thing that could sensibly happen. `top` is measured downward from the panel's
 * top edge, so the largest `top` is the lowest balloon; ties keep array order, which is
 * creation order.
 *
 * Filtering by panel as well as by name is what keeps a chain a *drawn* thing: two
 * balloons on different panels are never on screen together (reveal is per panel), so
 * they cannot read as one column however they are named.
 */
export function chainSlots(bubbles: readonly ChainMember[], id: string, panel: number): number[] {
  if (!id) return []
  const members: number[] = []
  bubbles.forEach((b, i) => {
    if (b.chain === id && b.panel === panel) members.push(i)
  })
  // Stable by construction: equal `top` values keep the order they were pushed in.
  return members.sort((a, b) => bubbles[b].top - bubbles[a].top)
}

/** Chain names present on `panel`, in first-appearance order. */
export function chainIdsOn(bubbles: readonly ChainMember[], panel: number): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const b of bubbles) {
    if (b.panel !== panel || !b.chain || seen.has(b.chain)) continue
    seen.add(b.chain)
    ids.push(b.chain)
  }
  return ids
}

/** Every chain name used anywhere, in first-appearance order (for the editor's list). */
export function chainIds(bubbles: readonly { chain: string }[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const b of bubbles) {
    if (!b.chain || seen.has(b.chain)) continue
    seen.add(b.chain)
    ids.push(b.chain)
  }
  return ids
}

/**
 * The thread a chain actually speaks: its own `messages` when it has any, otherwise the
 * words already on its balloons, in slot order. The fallback is what makes the `grow`
 * toggle useful on its own — an author who just wants three drawn lines to arrive one
 * after another never has to retype them into a chain field.
 */
export function chainTranscript(chain: BubbleChain, slotTexts: readonly string[]): string[] {
  return chain.messages.length > 0 ? [...chain.messages] : [...slotTexts]
}

/** Pull a head index into `[0, total)`; -1 for an empty transcript (nothing to show). */
export function clampHead(head: number, total: number): number {
  if (total <= 0) return -1
  return Math.min(Math.max(head, 0), total - 1)
}

/**
 * The newest message index growth climbs to: enough to fill the drawn slots, and no
 * further. Growth stops where the column is full; going beyond it is scrolling, which
 * is the reader's to do and not the animation's.
 */
export function growTarget(slots: number, total: number): number {
  return Math.min(slots, total) - 1
}

/**
 * The messages on screen, as message indices in **slot order** — result[k] is what slot
 * k shows, and slot 0 is the root. `head` is the newest message shown; the window ends
 * there and extends down as far as the drawn slots reach.
 *
 * While a chain is still growing, head is below the top slot and the result is short:
 * the slots above it simply have nothing in them yet, which is how they stay unrendered
 * rather than rendering empty balloons.
 */
export function visibleWindow(head: number, slots: number): number[] {
  if (head < 0 || slots <= 0) return []
  const offset = Math.max(0, head - slots + 1)
  const out: number[] = []
  for (let m = offset; m <= head; m += 1) out.push(m)
  return out
}

/**
 * Move the window by `steps` of wheel travel (see wheelSteps in wheelPicker.ts).
 *
 * The sign is inverted on purpose. The column runs *upward* in time — the oldest message
 * is at the bottom — so scrolling up, which everywhere else reveals earlier content, has
 * to reveal later messages here or the thread reads backwards. Wheel-up gives a negative
 * `steps`, and subtracting it advances the head; the messages then slide down through the
 * slots, which is the same direction the page content moves when you scroll up.
 */
export function stepHead(head: number, steps: number, total: number): number {
  return clampHead(head - steps, total)
}
