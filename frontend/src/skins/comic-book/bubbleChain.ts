import { BUBBLE_ASPECT } from './bubbleBox'
import type { BubbleTransform } from './editor/types'

// A bubble *chain* is an SMS conversation, drawn the way a phone draws one: two columns
// sharing one transcript. The recipient speaks down the **left** column, the sender down
// the **right**, and the rows run in the order the messages were sent — so one party
// saying two things in a row simply takes two rows in a row.
//
//     Hey, you around?
//     Line's been busy all morning
//                          Just picked up
//     Any luck?
//                          [ the composer ]
//
// **Linkage is what joins the two columns.** A chain's members are the balloons wired
// together by `linkTo` — the same graph a connector tube is declared on — and one checkbox
// on either says which of the two a linked group is: a welded pair of fixed balloons, or a
// conversation. That is why there is no chain *name* to type: the author draws the two
// balloons they can see, links them, ticks a box, and the id the group carries is
// bookkeeping the editor generates and never shows.
//
// **The two balloons are templates, not slots.** This is the part that changed: a chain
// used to be N drawn balloons with messages sliding through them, which cannot draw the
// picture above — the rows there belong to the conversation, not to either column, and one
// party sending two in a row shifts every balloon below. So the author draws *one balloon
// per column* — its shape, tail, rotation, lettering and the column's edge — and every row
// is stamped from the template of the side it belongs to. The table is rigid on purpose:
// two columns, at most `rows` rows, the composer at the bottom right.
//
// **The rows are laid out from the bottom up**, anchored on the sender template, because
// that is where a conversation happens: the newest message sits where the composer is and
// older ones climb away. `top` for each row is the running sum of the heights below it, so
// a long message pushes the thread up by exactly its own height rather than by a fixed
// pitch that a two-line balloon would overlap.
//
// **Bubble size follows the message.** A three-word reply is a small balloon and a long one
// fills its column — see {@link messageWidth}. The template's own width is the widest a
// balloon on that side gets, so the author still sets the scale.
//
// Scrolling is not a per-chain toggle: a chain *is* a window over a transcript, so the
// wheel always moves it. Two things ride on top, and both are optional:
//
//   grow — the conversation arrives one message at a time instead of all at once.
//   live — the sender template is a text input, so a reader types a message and Enter
//          pushes it into the thread. `content: 'input'` on that balloon is the whole
//          switch; the composer keeps the bottom row and the messages start one row up.
//
// Everything here is pure. PanelBubbleChain.tsx is the DOM shell over it, the way
// BubbleWheel.tsx is over wheelPicker.ts — it owns only what cannot be a function: the
// growth timer, the wheel listener, the panel's measured aspect, and what a reader typed.

/** Per-chain behaviour, keyed by the `chain` id its member bubbles carry. */
export interface BubbleChain {
  /**
   * The id bubbles join by. Non-empty; '' on a bubble means "not in a chain". Generated
   * by the editor rather than typed (see `nextChainId`), because the author's expression
   * of "these balloons are one conversation" is the linkage plus the checkbox, not a name.
   */
  id: string
  /**
   * Play the transcript in, one message at a time: the oldest lands first and each one
   * after it pushes the thread up, until the table is full. False fills the table at once
   * — what a pair of bubbles did before chains existed. Ignored on a live chain, which
   * starts at its composer and grows as the reader types, which is the same effect with a
   * person driving it.
   */
  grow: boolean
  /** Delay between messages while growing, in ms. */
  stepMs: number
  /**
   * How many rows the table shows at once, counting the composer's. Past that the window
   * moves instead of the table growing — twenty messages through six rows is six on screen
   * and the wheel to reach the rest.
   */
  rows: number
  /**
   * The conversation, oldest first, one message per entry. A leading {@link OUT_PREFIX}
   * marks the *sender's* side — the right column, the one the composer is at the foot of;
   * everything else is the recipient's.
   *
   * Empty means the chain speaks its two balloons' own `text`, which is what a chain that
   * only wants the growth animation wants and keeps those words being edited where every
   * other bubble's words are edited. On a live chain it is the backlog the reader's own
   * messages are appended to, so empty is the ordinary state there: the thread starts at
   * the composer alone.
   */
  messages: string[]
  /**
   * Bind this conversation to the account's real SMS history. The transcript then comes
   * from the carrier rather than from {@link BubbleChain.messages}, and the composer sends
   * for real: Enter posts to `VsMessaging/Sms/Send` and the message reappears from the
   * server on the next poll.
   *
   * **Which conversation is not stored here.** It is whichever number the panel's
   * wheel-picker balloon is turned to (see {@link peerWheelOn}) — the reader chooses it,
   * so an authored value would be overwritten the first time they turned the wheel. A
   * chain with this set and no wheel to read shows nothing rather than guessing.
   */
  sms: boolean
}

/** Bounds for the growth delay, shared by the inspector's number field and hydration. */
export const CHAIN_STEP_MS = { min: 120, max: 5000, step: 20 }

/** Growth delay for a chain that does not name one. */
export const DEFAULT_CHAIN_STEP_MS = 900

/** Bounds for the row cap, shared by the inspector's number field and hydration. */
export const CHAIN_ROWS = { min: 2, max: 12, step: 1 }

/**
 * Rows a chain shows when it does not say. Six is about a phone's worth of conversation in
 * a comic panel: enough for a back-and-forth to read as one, few enough that the balloons
 * stay big enough to letter.
 */
export const DEFAULT_CHAIN_ROWS = 6

/** Gap between one row and the next, in % of the panel box height. */
export const CHAIN_ROW_GAP = 2

/**
 * Message length, in characters, at which a balloon reaches its column's full width.
 * Past it the balloon stops growing and the lettering wraps, which is what a balloon does.
 */
export const CHAIN_FULL_CHARS = 44

/** Narrowest a balloon gets, as a fraction of its column's full width. */
export const CHAIN_MIN_WIDTH_RATIO = 0.42

/**
 * What marks a transcript line as the *sender's*. A conversation is written the way a
 * chat log is written — one message per line, the outgoing ones quoted — so the author's
 * textarea and the stored array are the same text, and neither needs a second field per
 * message to say which side it is on.
 */
export const OUT_PREFIX = '> '

/**
 * What a chain id with no entry in the config means: a conversation shown whole, saying
 * what its two balloons say. That is deliberately the *inert* default — a hand-edited
 * `layoutConfig.ts` that ids a chain on two bubbles and forgets the chain entry gets the
 * behaviour those bubbles had before they were chained, not a surprise animation.
 */
export function defaultChain(id: string): BubbleChain {
  return {
    id,
    grow: false,
    stepMs: DEFAULT_CHAIN_STEP_MS,
    rows: DEFAULT_CHAIN_ROWS,
    messages: [],
    sms: false,
  }
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
    typeof c.rows === 'number' &&
    Number.isFinite(c.rows) &&
    Array.isArray(c.messages) &&
    c.messages.every(m => typeof m === 'string') &&
    typeof c.sms === 'boolean'
  )
}

/** One member of a chain, as far as the column ordering is concerned. */
interface ChainMember {
  chain: string
  panel: number
  right: number
}

/**
 * The bubbles of chain `id` on `panel`, as indices into `bubbles`, **rightmost first**:
 * member 0 is the sender's template, the one the composer is stamped from.
 *
 * Order comes from `right` and nothing else, so the author's own placement *is* the
 * assignment: drag a balloon across its partner and the two columns swap, which is the
 * only thing that could sensibly happen. `right` is measured inward from the panel's right
 * edge, so the *smallest* `right` is the rightmost balloon; ties keep array order, which
 * is creation order.
 *
 * Filtering by panel as well as by id is what keeps a chain a *drawn* thing: two balloons
 * on different panels are never on screen together (reveal is per panel), so they cannot
 * read as one conversation however they are linked.
 */
export function chainMembers(bubbles: readonly ChainMember[], id: string, panel: number): number[] {
  if (!id) return []
  const members: number[] = []
  bubbles.forEach((b, i) => {
    if (b.chain === id && b.panel === panel) members.push(i)
  })
  // Stable by construction: equal `right` values keep the order they were pushed in.
  return members.sort((a, b) => bubbles[a].right - bubbles[b].right)
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

/** The two templates a conversation is stamped from. */
export interface ChainColumns {
  /** The sender's: the right column, and the balloon the composer is stamped from. */
  me: BubbleTransform
  /** The recipient's: the left column. */
  them: BubbleTransform
}

/**
 * The same balloon flipped to the other side of the panel — its left edge where its right
 * edge was. This is what a chain with only one member gets for its second column, so a
 * conversation still reads as a conversation the moment the box is ticked, before the
 * author has drawn the other side.
 */
export function mirrorColumn(b: BubbleTransform): BubbleTransform {
  return { ...b, right: 100 - b.right - b.width }
}

/**
 * The columns of a chain, given its members rightmost-first ({@link chainMembers}).
 *
 * Rigidly two: the rightmost member is the sender and the leftmost is the recipient, and a
 * third balloon between them is ignored rather than becoming a third column. The author
 * asked for a table of two columns, and two balloons is the whole of drawing one.
 */
export function chainColumns(members: readonly BubbleTransform[]): ChainColumns | null {
  if (members.length === 0) return null
  const me = members[0]
  return { me, them: members.length > 1 ? members[members.length - 1] : mirrorColumn(me) }
}

/**
 * True when this balloon's content makes it a *composer* — a real field the reader types
 * into. Only the sender template's answer matters (see {@link messageRows}); an input on
 * the recipient's side is just a balloon with an input in it, because the recipient's
 * column holds messages that have already been sent.
 */
export function isComposerContent(content: string): boolean {
  return content === 'input' || content === 'phone'
}

/**
 * How many of a chain's rows hold messages.
 *
 * A live chain spends its bottom row on the composer, so a six-row table shows the composer
 * and the five newest messages — six rows on screen, one of them the one being typed into.
 * That is what makes the conversation *grow by one* per message: the first Enter turns a
 * lone composer into a composer plus a message.
 */
export function messageRows(rows: number, live: boolean): number {
  return live ? Math.max(0, rows - 1) : rows
}

/** One message of a conversation, once the side marker has been read off it. */
export interface ChainLine {
  /** True when the sender said it — the right column. */
  out: boolean
  text: string
}

/** Read the side markers off a stored transcript. */
export function readTranscript(messages: readonly string[]): ChainLine[] {
  return messages.map(m =>
    m.startsWith(OUT_PREFIX)
      ? { out: true, text: m.slice(OUT_PREFIX.length) }
      : { out: false, text: m },
  )
}

/**
 * The balloon on `panel` whose wheel picker names the number a live conversation is with,
 * or -1 when the panel has none.
 *
 * The rule is the whole binding, so it is worth stating plainly: **the first wheel-picker
 * balloon on the panel that is not itself part of a chain.** Nothing else marks it — no
 * field on the bubble, no number in the chain — because the author's expression of "this
 * panel picks a number" is already the balloon they drew and set to `wheel`, in the same
 * way that linkage plus a checkbox is how they express "these two are a conversation".
 *
 * A chain member is excluded because a chain may hold a wheel of its own inside the
 * conversation, and that one is picking something the conversation says rather than who it
 * is with.
 */
export function peerWheelOn(
  bubbles: readonly { panel: number; chain: string; content: string }[],
  panel: number,
): number {
  return bubbles.findIndex(b => b.panel === panel && b.chain === '' && b.content === 'wheel')
}

/**
 * A carrier transcript in the form the rest of this module reads: oldest first, the
 * sender's side marked with {@link OUT_PREFIX}.
 *
 * Which column a message lands in comes from its `outbound` flag — what the database
 * recorded when it was sent or received — and never from comparing numbers. A customer
 * that texts one of its own numbers would otherwise put both halves of the exchange in
 * the same column.
 */
export function smsTranscript(
  messages: readonly { text: string; outbound: boolean }[],
): string[] {
  return messages.map(m => (m.outbound ? `${OUT_PREFIX}${m.text}` : m.text))
}

/**
 * The conversation a chain actually speaks: its own `messages` when it has any, otherwise
 * the words already on its two balloons — the recipient's line, then the sender's. The
 * fallback is what makes the `grow` toggle useful on its own, and it is why ticking the box
 * on a pair of drawn balloons never makes them disappear.
 */
export function chainTranscript(
  chain: BubbleChain,
  members: readonly BubbleTransform[],
): string[] {
  if (chain.messages.length > 0) return [...chain.messages]
  return members
    .map((b, i) => ({ b, out: i === 0 }))
    .reverse()
    .filter(({ b }) => b.text.trim().length > 0)
    .map(({ b, out }) => (out ? `${OUT_PREFIX}${b.text}` : b.text))
}

/**
 * How wide a balloon holding `text` is, in % of the panel box, given the full width of its
 * column. Short messages get a small balloon and long ones fill the column, easing between
 * the two so a conversation of mixed lengths has a ragged edge rather than a ruled one —
 * which is what a phone's conversation looks like, and what tells the two columns apart at
 * a glance.
 *
 * Linear in the character count, which is the honest measure here: the lettering wraps
 * inside the balloon, so past {@link CHAIN_FULL_CHARS} extra words make it *taller*, not
 * wider, and a width that kept growing would only push the balloon off the panel.
 */
export function messageWidth(text: string, full: number): number {
  const chars = text.trim().length
  const t = Math.min(1, chars / CHAIN_FULL_CHARS)
  return full * (CHAIN_MIN_WIDTH_RATIO + (1 - CHAIN_MIN_WIDTH_RATIO) * t)
}

/**
 * A balloon's height in % of the panel box *height*, for one `width`% wide.
 *
 * The balloon's box is its width times {@link BUBBLE_ASPECT} — the outline SVG carries a
 * viewBox and the DOM height resolves from it — so converting that to a share of the panel
 * needs the panel's own aspect ratio (`width / height`), which only the DOM knows. That is
 * the one measured number in the layout, and it is a *ratio*, so a chain laid out before
 * the panel has been measured (aspect 1) is still laid out in the right order and merely
 * spaced as though the panel were square.
 */
export function bubbleHeightPct(width: number, panelAspect: number): number {
  return width * BUBBLE_ASPECT * panelAspect
}

/** One balloon of a rendered conversation. */
export interface ChainRow {
  /**
   * React key. A message keeps its key as the thread scrolls, which is what lets CSS
   * animate it climbing rather than the balloons swapping text — see PanelBubbleChain.
   */
  key: string
  bubble: BubbleTransform
}

/**
 * The whole conversation as placed balloons, bottom row first.
 *
 * `shown` is the window over the transcript, newest first ({@link visibleWindow}), so this
 * walks up the panel in exactly that order: the composer if the chain is live, then the
 * newest message, then the one before it. Each row's `top` is the anchor minus everything
 * stacked below it, so the rows tile without a fixed pitch to overlap.
 *
 * Two details are what make it read as a conversation rather than as a list:
 *
 * - **Alignment.** The sender's balloons hang from their column's right edge and the
 *   recipient's from its left, so a short message stays on its own side of the panel
 *   instead of drifting toward the middle as it shrinks.
 * - **One tail per side.** Only the newest balloon of each column keeps its template's
 *   tail — the one still being said. A tail on every balloon reads as a crowd all talking
 *   at once, which is exactly what a thread is not.
 */
export function conversationRows(
  shown: readonly number[],
  lines: readonly ChainLine[],
  cols: ChainColumns,
  live: boolean,
  panelAspect: number,
): ChainRow[] {
  const rows: ChainRow[] = []
  // The left column's left edge, which is what its balloons are aligned against.
  const themLeft = 100 - cols.them.right - cols.them.width
  const tailed = { out: false, in: false }
  let top = cols.me.top

  const stack = (width: number): void => {
    top -= bubbleHeightPct(width, panelAspect) + CHAIN_ROW_GAP
  }

  if (live) {
    rows.push({ key: 'composer', bubble: { ...cols.me, top } })
    tailed.out = true
    stack(cols.me.width)
  }

  for (const m of shown) {
    const line = lines[m]
    if (!line) continue
    const template = line.out ? cols.me : cols.them
    const width = messageWidth(line.text, template.width)
    const side = line.out ? 'out' : 'in'
    rows.push({
      key: String(m),
      bubble: {
        ...template,
        top,
        width,
        right: line.out ? cols.me.right : 100 - themLeft - width,
        tail: tailed[side] ? 'none' : template.tail,
        // A message is lettering, whatever the template it was stamped from does: the
        // sender's template is routinely an input, and cloning that would put a field in
        // every balloon of the right column.
        content: 'text',
        text: line.text,
        // The templates are linked to each other — that linkage is the chain — and a
        // stamped row is not a balloon anything can link to.
        linkTo: null,
      },
    })
    tailed[side] = true
    stack(width)
  }

  return rows
}

/** Pull a head index into `[0, total)`; -1 for an empty transcript (nothing to show). */
export function clampHead(head: number, total: number): number {
  if (total <= 0) return -1
  return Math.min(Math.max(head, 0), total - 1)
}

/**
 * The newest message index growth climbs to: enough to fill the table, and no further.
 * Growth stops where the table is full; going beyond it is scrolling, which is the
 * reader's to do and not the animation's.
 */
export function growTarget(rows: number, total: number): number {
  return Math.min(rows, total) - 1
}

/**
 * The messages on screen, as message indices **newest first** — result[0] is the bottom
 * row of the table and each one after it sits above. `head` is the newest message shown.
 *
 * While a chain is still growing, or while the reader has typed fewer messages than the
 * table can hold, the result is short: the rows above simply have nothing in them yet,
 * which is how they stay unrendered rather than rendering empty balloons.
 */
export function visibleWindow(head: number, rows: number): number[] {
  if (head < 0 || rows <= 0) return []
  const out: number[] = []
  for (let m = head; m > head - rows && m >= 0; m -= 1) out.push(m)
  return out
}

/**
 * Move the window by `steps` of wheel travel (see wheelSteps in wheelPicker.ts).
 *
 * The sign is the ordinary one, because the table is laid out the ordinary way: older
 * messages are *above* the newest, so wheel-up — which everywhere else reveals earlier
 * content — walks the head back down the transcript. `wheelSteps` gives wheel-up a
 * negative `steps`, and adding it does exactly that.
 */
export function stepHead(head: number, steps: number, total: number): number {
  return clampHead(head + steps, total)
}
