// A bubble *chain* is a column of balloons an author drew by hand, read as one speaker's
// SMS thread.
//
// **Linkage is what joins them.** A chain's slots are the balloons wired together by
// `linkTo` — the same graph a connector tube is declared on — and one checkbox on any
// member says which of the two a linked group is: a welded pair of fixed balloons, or a
// scrollable thread. That is why there is no chain *name* to type: the author links the
// balloons they can see and ticks a box, and the id the group carries is bookkeeping the
// editor generates and never shows.
//
// **The column runs downward in time.** The lowest balloon — the root, the one whose tail
// grows out of the character's mouth — holds the *newest* message, and each balloon above
// it is older. That is the direction a thread grows when someone speaks into it: what was
// just said sits where the speaking happens, and what came before drifts up and away. It
// is also the direction a reader reads a panel, top to bottom, oldest first.
//
// The *slots* are the author's drawing and never move; the *messages* move through them.
// That separation is the whole design. It means an author draws three balloons in the
// editor, tunes their placement, rotation and shape as usual, and the thread then runs
// through those three shapes however many messages it holds — rather than the code
// having to invent a fourth balloon's geometry, which it has no way to make look drawn.
//
// Scrolling is not a per-chain toggle: a chain *is* a window over a transcript, so the
// wheel always moves it. Two things do ride on top, and both are optional:
//
//   grow — the column arrives one balloon at a time instead of all at once.
//   live — the root slot is a text input, so a reader types a message and Enter pushes it
//          into the thread. `content: 'input'` on the root balloon is the whole switch;
//          the composer keeps the root slot and the messages start one slot up.
//
// Everything here is pure and vertical-only: slot order is decided by `top` alone, so a
// chain that wanders sideways still stacks bottom-to-top in message order. PanelBubbleChain.tsx
// is the DOM shell over these, the way BubbleWheel.tsx is over wheelPicker.ts.

/** Per-chain behaviour, keyed by the `chain` id its member bubbles carry. */
export interface BubbleChain {
  /**
   * The id bubbles join by. Non-empty; '' on a bubble means "not in a chain". Generated
   * by the editor rather than typed (see `nextChainId`), because the author's expression
   * of "these balloons are one thread" is the linkage plus the checkbox, not a name.
   */
  id: string
  /**
   * Play the transcript in, one balloon at a time: the first message appears in the root
   * and each one after it lands there too, pushing the older ones up the column, until
   * the drawn slots are full. False fills the column at once — what a column of bubbles
   * did before chains existed. Ignored on a live chain, which starts at its composer and
   * grows as the reader types, which is the same effect with a person driving it.
   */
  grow: boolean
  /** Delay between balloons while growing, in ms. */
  stepMs: number
  /**
   * The thread. Empty means the chain speaks the slots' own `text`, in slot order —
   * which is what a chain that only wants the growth animation wants, and keeps the
   * words being edited where every other bubble's words are edited. On a live chain it
   * is the backlog the reader's own messages are appended to, so empty is the ordinary
   * state there: the thread starts at the composer alone.
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
 * `layoutConfig.ts` that ids a chain on two bubbles and forgets the chain entry gets
 * the behaviour those bubbles had before they were chained, not a surprise animation.
 */
export function defaultChain(id: string): BubbleChain {
  return { id, grow: false, stepMs: DEFAULT_CHAIN_STEP_MS, messages: [] }
}

/** Runtime guard for a persisted chain entry, mirroring isBubbleType / isTailDir. */
export function isBubbleChain(value: unknown): value is BubbleChain {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<BubbleChain>
  return (
    typeof c.id === 'string' &&
    c.id.length > 0 &&
    typeof c.grow === 'boolean' &&
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
 * Filtering by panel as well as by id is what keeps a chain a *drawn* thing: two
 * balloons on different panels are never on screen together (reveal is per panel), so
 * they cannot read as one column however they are linked.
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

/** Chain ids present on `panel`, in first-appearance order. */
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

/** Every chain id used anywhere, in first-appearance order. */
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
 * True when this balloon's content makes it a *composer* — a real field the reader types
 * into. Only the root slot's answer matters (see {@link messageSlots}); an input higher
 * up the column is just a balloon with an input in it, because the slot it sits in holds
 * whatever message has scrolled there.
 */
export function isComposerContent(content: string): boolean {
  return content === 'input' || content === 'phone'
}

/**
 * How many of a chain's drawn slots hold messages.
 *
 * A live chain spends its root slot on the composer, so a three-balloon column shows the
 * composer and the two newest messages — three balloons on screen, one of them the one
 * being typed into. That is what makes the column *grow by one* per message: the first
 * Enter turns a lone composer into a composer plus a message.
 */
export function messageSlots(slots: number, live: boolean): number {
  return live ? Math.max(0, slots - 1) : slots
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
 * The messages on screen, as message indices in **slot order** — result[k] is what the
 * k-th message slot shows, counting up the column from the root end. `head` is the newest
 * message shown and it sits at result[0]; everything above it is older.
 *
 * While a chain is still growing, or while the reader has typed fewer messages than the
 * column can hold, the result is short: the slots above simply have nothing in them yet,
 * which is how they stay unrendered rather than rendering empty balloons.
 */
export function visibleWindow(head: number, slots: number): number[] {
  if (head < 0 || slots <= 0) return []
  const out: number[] = []
  for (let m = head; m > head - slots && m >= 0; m -= 1) out.push(m)
  return out
}

/**
 * Move the window by `steps` of wheel travel (see wheelSteps in wheelPicker.ts).
 *
 * The sign is the ordinary one, because the column is laid out the ordinary way: older
 * messages are *above* the newest, so wheel-up — which everywhere else reveals earlier
 * content — walks the head back down the transcript. `wheelSteps` gives wheel-up a
 * negative `steps`, and adding it does exactly that.
 */
export function stepHead(head: number, steps: number, total: number): number {
  return clampHead(head + steps, total)
}
