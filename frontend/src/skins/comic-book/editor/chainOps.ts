import {
  CHAIN_ROWS, CHAIN_STEP_MS, DEFAULT_CHAIN_ROWS, DEFAULT_CHAIN_STEP_MS, isBubbleChain,
  OUT_PREFIX,
} from '../bubbleChain'
import type { BubbleChain } from '../bubbleChain'

// The chain list's lifecycle, and the linkage the list is derived *through*. It sits
// apart from configOps.ts because a chain is not edited the way a picture or a bubble is:
// there is no add button and no delete button for one. The list is *derived* —
// `syncChains` recomputes it from whatever ids the bubbles carry, and `propagateChains`
// decides those ids from how the bubbles are linked — and the only direct edit is
// patching a chain that already exists.
//
// That is deliberate. A chain with no members would render nothing and still sit in the
// inspector offering settings, and a bubble carrying a chain id with no entry would be a
// silent no-op; both states are unreachable if the list is a function of the bubbles.

/**
 * A chain the author has just ticked the box on. `grow` defaults *on*: asking for a chain
 * is asking for the balloons to behave like a conversation, and a table that arrives whole
 * is indistinguishable from the loose bubbles it was a moment ago. There is no `scroll`
 * counterpart — a chain is a window over a transcript, so the wheel always moves it, and
 * the checkbox that created the chain is that promise.
 *
 * Note this is the opposite of `defaultChain` in ../bubbleChain.ts, which is what an id
 * with no entry falls back to at render time. The two differ because they answer
 * different questions: this one is "the author asked for a chain", that one is "a
 * hand-edited file forgot to say", and quietly animating the second would be a surprise.
 */
export const NEW_CHAIN: Omit<BubbleChain, 'id'> = {
  grow: true,
  stepMs: DEFAULT_CHAIN_STEP_MS,
  rows: DEFAULT_CHAIN_ROWS,
  messages: [],
  // Off, unlike `grow`. Binding a chain to a real thread means what is drawn in the panel
  // is somebody's actual messages and Enter sends one — that is not something ticking the
  // chain box can be taken to have asked for.
  sms: false,
}

/** Prefix of a generated chain id. Never shown to the author — see {@link nextChainId}. */
const CHAIN_ID_PREFIX = 'chain-'

/**
 * A chain id nothing on the page is using. Chains are named by the editor rather than by
 * the author, because the author's way of saying "these balloons are one thread" is to
 * link them and tick the box; a name would be a second, redundant way to say it that
 * could disagree with the first.
 *
 * The id still exists because the chain's *settings* need somewhere to live that survives
 * bubbles being added, deleted and renumbered — see {@link syncChains}.
 */
export function nextChainId(bubbles: readonly { chain: string }[]): string {
  const used = new Set(bubbles.map(b => b.chain))
  for (let n = 1; ; n += 1) {
    const id = `${CHAIN_ID_PREFIX}${n}`
    if (!used.has(id)) return id
  }
}

/**
 * The bubbles reachable from one another through `linkTo`, as index lists — one list per
 * group, in first-appearance order, and a bubble nothing links to is a group of one.
 *
 * The link is symmetric: declaring it on either end joins the pair, so this is a plain
 * union over both directions and a run of `a -> b -> c` is one group of three. That is
 * how a column of any length gets built out of a field that holds a single partner.
 *
 * Cross-panel and out-of-range links are skipped rather than followed. `sanitizeLinks`
 * has normally nulled them already, but this runs on raw payloads too and a group
 * spanning two panels is not a thing that can be on screen at once.
 */
export function linkGroups(
  bubbles: readonly { panel: number; linkTo: number | null }[],
): number[][] {
  const parent = bubbles.map((_, i) => i)
  const find = (start: number): number => {
    let i = start
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  bubbles.forEach((b, i) => {
    const j = b.linkTo
    if (j == null || j === i || !bubbles[j] || bubbles[j].panel !== b.panel) return
    const [ra, rb] = [find(i), find(j)]
    // Always parent to the lower index, so a group's root is its first member and the
    // grouping below comes out in first-appearance order.
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  })
  const groups = new Map<number, number[]>()
  bubbles.forEach((_, i) => {
    const root = find(i)
    const found = groups.get(root)
    if (found) found.push(i)
    else groups.set(root, [i])
  })
  return [...groups.values()]
}

/**
 * Settle every bubble's `chain` id from the linkage: one id per linked group, or '' for a
 * group no member is chained in.
 *
 * This is what makes linkage the single source of truth. Ticking the box on one balloon
 * chains the whole group it is linked into; linking a loose balloon onto a chained one
 * makes it a slot of that chain without the author naming anything; and unlinking one
 * leaves it a group of its own, still chained — a one-slot chain, which is exactly the
 * lone composer a live thread starts as.
 *
 * A group holding two ids — reachable by linking two separate chains together — keeps the
 * first, so the settings of the chain the author started from survive the merge.
 */
export function propagateChains<
  T extends { panel: number; linkTo: number | null; chain: string },
>(bubbles: readonly T[]): T[] {
  const out = [...bubbles]
  for (const group of linkGroups(bubbles)) {
    const id = group.map(i => bubbles[i].chain).find(c => c !== '') ?? ''
    for (const i of group) {
      if (bubbles[i].chain !== id) out[i] = { ...bubbles[i], chain: id }
    }
  }
  return out
}

/** Deep clone of one chain (its `messages` array is copied, not shared). */
export function cloneChain(c: BubbleChain): BubbleChain {
  return { ...c, messages: [...c.messages] }
}

/**
 * Reconcile the chain list against the bubbles: one entry per distinct non-empty
 * `chain` id, in first-appearance order, keeping whatever settings an existing entry
 * already had and creating {@link NEW_CHAIN} for an id that has just appeared. Ids no
 * bubble carries any more are dropped.
 *
 * Run after every edit that can touch a bubble's `chain`, its `linkTo`, its `panel` or
 * its existence — which is the same set of edits `sanitizeLinks` and
 * {@link propagateChains} run after, and for the same reason.
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
 * Pull a row cap into the range the inspector offers. A table of one row is a single
 * balloon and not a conversation, and one of fifty is a wall of lettering nobody can read
 * at panel size, so both ends are held rather than trusted.
 */
export function clampRows(rows: number): number {
  if (!Number.isFinite(rows)) return DEFAULT_CHAIN_ROWS
  return Math.min(Math.max(Math.round(rows), CHAIN_ROWS.min), CHAIN_ROWS.max)
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
    next.rows = clampRows(next.rows)
    return next
  })
}

/**
 * Read a persisted chain list back, dropping entries that are not chains and clamping
 * the ones that are. Returns [] for anything that is not an array, which is the same
 * answer as a payload written before chains existed — {@link syncChains} then rebuilds
 * the list from the bubbles, so the only thing an old payload loses is settings it
 * never had.
 *
 * The row cap is defaulted *before* the guard rather than after it, so a payload saved
 * when a chain was a hand-drawn column and had no `rows` keeps its transcript instead of
 * being dropped as malformed and rebuilt empty. `sms` is backfilled the same way and for
 * the same reason — and to `false`, which is the only safe reading of a file that predates
 * the flag: a chain nobody said to bind must not start sending.
 */
export function hydrateChains(raw: unknown): BubbleChain[] {
  if (!Array.isArray(raw)) return []
  const out: BubbleChain[] = []
  const seen = new Set<string>()
  for (const stored of raw) {
    const entry =
      stored && typeof stored === 'object'
        ? { rows: DEFAULT_CHAIN_ROWS, sms: false, ...(stored as object) }
        : stored
    if (!isBubbleChain(entry) || seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(
      cloneChain({ ...entry, stepMs: clampStepMs(entry.stepMs), rows: clampRows(entry.rows) }),
    )
  }
  return out
}

/**
 * A chain id, normalised. The editor generates its own ids and never needs this, but a
 * hand-edited `layoutConfig.ts` is written by a person: trailing whitespace would make
 * two visually identical ids two different chains, and inner runs of space the same. It
 * is also what keeps {@link nextChainId}'s "is this id taken" check honest. Empty is the
 * valid "not in a chain" answer.
 */
export function normalizeChainId(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * The author's `messages` textarea, one message per line, written the way a chat log is
 * written: a line starting with `>` is the *sender's* — the right column, the one the
 * composer is at the foot of — and everything else is the recipient's.
 *
 * The marker is normalised to exactly {@link OUT_PREFIX} here, so `>Yeah`, `> Yeah` and
 * `>   Yeah` are one message and not three spellings of one. Blank lines are dropped: they
 * are the author laying the box out, and an empty balloon is not a message. An empty result
 * is the meaningful "speak the balloons' own text" state (see chainTranscript).
 */
export function parseMessages(text: string): string[] {
  return text
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => (s.startsWith('>') ? `${OUT_PREFIX}${s.slice(1).trim()}` : s))
    // A bare `>` is a marker with nothing after it — still not a message.
    .filter(s => s !== OUT_PREFIX)
}
