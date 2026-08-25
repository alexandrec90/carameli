import { CHAIN_STEP_MS, DEFAULT_CHAIN_STEP_MS, isBubbleChain } from '../bubbleChain'
import type { BubbleChain } from '../bubbleChain'

// The chain list's lifecycle. It sits apart from configOps.ts because a chain is not
// edited the way a picture or a bubble is: there is no add button and no delete button
// for one. The list is *derived* — `syncChains` recomputes it from whatever names the
// bubbles carry — and the only direct edit is patching a chain that already exists.
//
// That is deliberate. A chain with no members would render nothing and still sit in the
// inspector offering settings, and a bubble naming a chain with no entry would be a
// silent no-op; both states are unreachable if the list is a function of the bubbles.

/**
 * A chain the author has just named on a bubble. Both behaviours default *on*: naming a
 * chain is the act of asking for one, and a chain that arrives whole and refuses to
 * scroll is indistinguishable from the loose bubbles it was a moment ago.
 *
 * Note this is the opposite of `defaultChain` in ../bubbleChain.ts, which is what a name
 * with no entry falls back to at render time. The two differ because they answer
 * different questions: this one is "the author asked for a chain", that one is "a
 * hand-edited file forgot to say", and quietly animating the second would be a surprise.
 */
export const NEW_CHAIN: Omit<BubbleChain, 'id'> = {
  grow: true,
  scroll: true,
  stepMs: DEFAULT_CHAIN_STEP_MS,
  messages: [],
}

/** Deep clone of one chain (its `messages` array is copied, not shared). */
export function cloneChain(c: BubbleChain): BubbleChain {
  return { ...c, messages: [...c.messages] }
}

/**
 * Reconcile the chain list against the bubbles: one entry per distinct non-empty
 * `chain` name, in first-appearance order, keeping whatever settings an existing entry
 * already had and creating {@link NEW_CHAIN} for a name that has just appeared. Names no
 * bubble carries any more are dropped.
 *
 * Run after every edit that can touch a bubble's `chain`, its `panel` or its existence —
 * which is the same set of edits `sanitizeLinks` runs after, and for the same reason.
 */
export function syncChains(
  bubbles: readonly { chain: string }[],
  chains: readonly BubbleChain[],
): BubbleChain[] {
  const existing = new Map(chains.map(c => [c.id, c]))
  const out: BubbleChain[] = []
  const seen = new Set<string>()
  for (const b of bubbles) {
    if (!b.chain || seen.has(b.chain)) continue
    seen.add(b.chain)
    const found = existing.get(b.chain)
    out.push(found ? cloneChain(found) : { id: b.chain, ...NEW_CHAIN, messages: [] })
  }
  return out
}

/** Pull a growth delay into the range the inspector offers. */
export function clampStepMs(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_CHAIN_STEP_MS
  return Math.min(Math.max(Math.round(ms), CHAIN_STEP_MS.min), CHAIN_STEP_MS.max)
}

/**
 * Patch-merge one chain by id, returning a new list. A patch for an id that is not
 * there is a no-op rather than an insert: the list is the bubbles' to grow, and an
 * inspector editing a chain nobody is in has nothing to show the result on.
 */
export function patchChainIn(
  chains: readonly BubbleChain[],
  id: string,
  patch: Partial<BubbleChain>,
): BubbleChain[] {
  return chains.map(c => {
    if (c.id !== id) return cloneChain(c)
    const next = cloneChain({ ...c, ...patch })
    // `id` is the join key, not a setting — renaming a chain here would orphan every
    // bubble pointing at it, and the rename that *does* work is on the bubble's field.
    next.id = c.id
    next.stepMs = clampStepMs(next.stepMs)
    return next
  })
}

/**
 * Read a persisted chain list back, dropping entries that are not chains and clamping
 * the ones that are. Returns [] for anything that is not an array, which is the same
 * answer as a payload written before chains existed — {@link syncChains} then rebuilds
 * the list from the bubbles, so the only thing an old payload loses is settings it
 * never had.
 */
export function hydrateChains(raw: unknown): BubbleChain[] {
  if (!Array.isArray(raw)) return []
  const out: BubbleChain[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!isBubbleChain(entry) || seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(cloneChain({ ...entry, stepMs: clampStepMs(entry.stepMs) }))
  }
  return out
}

/**
 * An author-typed chain name, normalised. Trimmed because trailing whitespace makes two
 * visually identical names two different chains, and collapsed to single spaces for the
 * same reason. Empty is the valid "not in a chain" answer.
 */
export function normalizeChainId(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * The author's `messages` textarea, one message per line. Blank lines are dropped: they
 * are the author laying the box out, and an empty balloon is not a message. An empty
 * result is the meaningful "speak the balloons' own text" state (see chainTranscript).
 */
export function parseMessages(text: string): string[] {
  return text
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}
