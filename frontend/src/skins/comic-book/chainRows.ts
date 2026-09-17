import { fitMessage } from './bubbleFit'
import type { BubbleFit } from './bubbleFit'
import { CHAIN_MIN_WIDTH_RATIO, TYPING_KEY, sideOrdinals } from './bubbleChain'
import type { ChainColumns, ChainLine, ChainRow } from './bubbleChain'
import { anchorOf, placeOnAnchor } from './chainAnchor'
import { stackedTop, zigzagShift } from './chainLayout'
import type { ChainMetrics, PlacedRow } from './chainLayout'
import type { BubbleTransform } from './editor/types'

// Turning a transcript into placed balloons: the half of a chain that has geometry in it.
//
// bubbleChain.ts owns what a chain *is* — its members, its two columns, the transcript it
// reads and the window over that transcript. This file owns what the panel then draws:
// every row is cut from the template of the side it belongs to (`stampRow`) and then put
// somewhere (`placeRows`), and `conversationRows` is the two of those in order.
//
// The split follows the imports. Everything measured — bubbleFit for a balloon's size,
// chainAnchor for where the newest one sits, chainLayout for where the rest tile — is
// reached from here and from nowhere else in the chain model.

/**
 * Cut a row from its side's template: fitted to `text`, leaning inward by its ordinal
 * from its column's outer edge, and still at its template's `top` — {@link placeRows}
 * decides that, once every row of the table is cut.
 *
 * The `newest` row of a side is the template as the author drew it: its full width, at
 * its own edge, so that with a message that fits on one line it is the balloon in the
 * editor, exactly. Only a message that wraps changes it, and only by making it taller
 * (`stretch`) — the author sized and placed it by hand, and the one thing a message may
 * do to it is need more room. The rows above it are fitted to their words.
 */
function stampRow(
  cols: ChainColumns,
  metrics: ChainMetrics,
  out: boolean,
  text: string,
  ordinal: number,
  tail: BubbleTransform['tail'],
  newest: boolean,
): Pick<ChainRow, 'bubble' | 'stretch'> {
  const template = out ? cols.me : cols.them
  // The left column's left edge, which is what its balloons are aligned against.
  const themLeft = 100 - cols.them.right - cols.them.width
  const fit = fitMessage(
    text,
    template.type,
    template.width,
    newest ? template.width : template.width * CHAIN_MIN_WIDTH_RATIO,
    metrics,
  )
  const shift = newest ? 0 : zigzagShift(ordinal, out, template.width - fit.width)
  return {
    bubble: {
      ...template,
      width: fit.width,
      right: out ? cols.me.right + shift : 100 - themLeft - shift - fit.width,
      tail,
      // A message is lettering, whatever the template it was stamped from does: the
      // sender's template is routinely an input, and cloning that would put a field in
      // every balloon of the right column.
      content: 'text',
      text,
      // The templates are linked to each other — that linkage is the chain — and a
      // stamped row is not a balloon anything can link to.
      linkTo: null,
    },
    stretch: fit.stretch,
  }
}

/**
 * Put the cut rows on the panel, bottom row first.
 *
 * The newest row of each side goes first, on its template's anchor (chainAnchor.ts):
 * the balloon still talking is the template as the author drew it, and when its words
 * have stretched it taller it grows away from the tip they aimed, which stays put. Every
 * other row is then placed
 * in conversation order by {@link stackedTop} against everything already on the panel —
 * tucked in alongside the row below it, clear of every balloon it would overlap. The
 * anchored rows are placed before their turn precisely so that they are among the
 * balloons the others must clear: the recipient's newest message can be five rows up the
 * transcript and still sit at the foot of the panel, beside the composer.
 */
function placeRows(rows: readonly ChainRow[], cols: ChainColumns, aspect: number): ChainRow[] {
  const out = [...rows]
  const placed: PlacedRow[] = []
  const newest = {
    out: rows.findIndex(row => row.side === 'out'),
    in: rows.findIndex(row => row.side === 'in'),
  }
  const settle = (i: number, at: Pick<BubbleTransform, 'top' | 'right'>): void => {
    out[i] = { ...out[i], bubble: { ...out[i].bubble, ...at } }
    placed.push({ bubble: out[i].bubble, stretch: out[i].stretch })
  }
  for (const i of [newest.out, newest.in]) {
    if (i < 0) continue
    const template = out[i].side === 'out' ? cols.me : cols.them
    settle(i, placeOnAnchor(anchorOf(template, aspect), out[i].bubble, out[i].stretch, aspect))
  }
  out.forEach((row, i) => {
    if (i === newest.out || i === newest.in) return
    // Row 0 is the newest of its side, so every row here has a settled one below it.
    const below = { bubble: out[i - 1].bubble, stretch: out[i - 1].stretch }
    const top = stackedTop(placed, { ...row.bubble, stretch: row.stretch }, aspect, below)
    settle(i, { top, right: row.bubble.right })
  })
  return out
}

/**
 * The whole conversation as placed balloons, bottom row first.
 *
 * `shown` is the window over the transcript, newest first ({@link visibleWindow}), so this
 * walks up the panel in exactly that order: the composer if the chain is live — `composer`
 * is its fit, from {@link fitComposer}, and `null` on a chain that has none — then the
 * newest message, then the one before it. The newest row of each side is its template as
 * drawn, on its anchor, and each other row is placed by `stackedTop` against everything
 * below — clear of what it would overlap, tucked in beside what it would not — so the
 * rows tile without a fixed pitch ({@link placeRows}).
 *
 * Three details are what make it read as a conversation rather than as a list:
 *
 * - **Alignment.** The sender's balloons hang from their column's right edge and the
 *   recipient's from its left, so a short message stays on its own side of the panel
 *   instead of drifting toward the middle as it shrinks — leaning inward every other
 *   message (`zigzagShift`), so the column is a zig-zag rather than a rule.
 * - **Size.** Each older balloon is fitted to its own message (`fitMessage`): wider up to
 *   its column, then taller, so long words wrap and long messages stretch the balloon.
 *   The newest of each side keeps the template's size and only ever grows taller. The
 *   composer is fitted the same way to the draft in it (`fitComposer`), keeping its
 *   template's width, so a message being typed grows the field it is being typed into.
 * - **One tail per side.** Only the newest balloon of each column keeps its template's
 *   tail — the one still being said. A tail on every balloon reads as a crowd all talking
 *   at once, which is exactly what a thread is not.
 *
 * `typing` adds one extra row at the foot of the recipient's column — the peer
 * mid-composition, drawn as dots by the shell (see {@link TYPING_KEY}). It is the
 * newest thing on their side, so it takes their template's tail and the messages above
 * it lose theirs, exactly as a newest message would; the caller shrinks the window by
 * one row while it is up so the table's height budget still holds.
 */
export function conversationRows(
  shown: readonly number[],
  lines: readonly ChainLine[],
  cols: ChainColumns,
  composer: BubbleFit | null,
  metrics: ChainMetrics,
  typing = false,
): ChainRow[] {
  const rows: ChainRow[] = []
  const tailed = { out: false, in: false }
  const ordinals = sideOrdinals(lines)

  if (composer) {
    // The template itself, at the width the author drew it — only its height answers to
    // the draft, and `placeRows` then hangs that height off the tail tip. Its `bubble` is
    // not stamped the way a message is: the field's content and its initial text are the
    // author's, and stamping would letter them instead of putting a field there.
    rows.push({ key: 'composer', side: 'out', bubble: cols.me, stretch: composer.stretch })
    tailed.out = true
  }

  if (typing) {
    // The recipient's template with dots in it instead of words: it stands in for the
    // reply, which lands in the same balloon, so the words appear where the dots were.
    const next = lines.filter(line => !line.out).length
    rows.push({ key: TYPING_KEY, side: 'in', ...stampRow(cols, metrics, false, '', next, cols.them.tail, true) })
    tailed.in = true
  }

  for (const m of shown) {
    const line = lines[m]
    if (!line) continue
    const side = line.out ? 'out' : 'in'
    const template = line.out ? cols.me : cols.them
    const newest = !tailed[side]
    const tail = newest ? template.tail : 'none'
    rows.push({ key: String(m), side, ...stampRow(cols, metrics, line.out, line.text, ordinals[m], tail, newest) })
    tailed[side] = true
  }

  return placeRows(rows, cols, metrics.aspect)
}
