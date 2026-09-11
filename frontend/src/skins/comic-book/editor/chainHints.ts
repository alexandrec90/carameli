// PURE: the wording the chain inspector shows, and the small amount of choosing that goes
// into it.
//
// Split out of ChainInspector.tsx because prose selection is branching, and branching in a
// component is the kind the structure gate counts: four ternaries inlined into one summary
// line put the inspector over its complexity limit for text that no rendering depends on.
// Here it is also directly testable, which a `{n === 1 ? '' : 's'}` buried in JSX is not.

/** What being one column of a conversation means, per side. */
const COLUMN = {
  live:
    'The sender — the right column. Its content is a field, so the bottom row is the '
    + 'composer: what a reader types there is sent as this side’s next message.',
  sender:
    'The sender — the right column. Give it `input` content to turn the bottom row into a '
    + 'composer a reader can type into.',
  recipient: 'The recipient — the left column.',
} as const

const STAMP =
  ' Every row of that side is stamped from this balloon: its shape, tail, rotation and '
  + 'lettering, at a width that follows the message. Drag it past its partner to swap the '
  + 'two columns over.'

const ROWS =
  'How many rows are on screen at once. The dashed frame on the panel is where they will '
  + 'land, and it is the whole of stretching the table: drag either balloon to move that '
  + 'side’s column, resize one to widen it, and change rows to set how far up the panel '
  + 'the conversation reaches.'

const GROWTH =
  'Outside edit mode this conversation starts at the composer alone and grows by one row '
  + 'per message, up to the rows it holds — after that each new message pushes the oldest '
  + 'visible one off the top.'

export const BOUND_HINT =
  'Bound to whichever number this panel’s picker balloon is showing. The transcript is '
  + 'not drawn — the balloons are the real messages — and Enter in the composer sends one '
  + 'for money. Nothing binds and nothing sends while the editor is open.'

/** Which side the selected balloon is, and what a template column means. */
export function columnHint(mine: boolean, live: boolean): string {
  if (!mine) return COLUMN.recipient + STAMP
  return (live ? COLUMN.live : COLUMN.sender) + STAMP
}

/** What `rows` does — plus how a live conversation grows into them, when it is one. */
export function rowsHint(live: boolean): string {
  return live ? `${ROWS} ${GROWTH}` : ROWS
}

/** `3 messages — 1 sent, 2 received — through 4 rows.`, as one line. */
export function transcriptSummary(
  total: number, out: number, holders: number, live: boolean,
): string {
  const messages = `${total} message${total === 1 ? '' : 's'}`
  const rows = `${holders} row${holders === 1 ? '' : 's'}`
  const composer = live ? ' (the bottom row is the composer)' : ''
  // A transcript longer than the window is not an error — the wheel is how the rest is
  // read — but it is the one thing about these numbers an author cannot see on the page.
  const tail = total > holders ? ' — the wheel scrolls the rest into view.' : '.'
  return `${messages} — ${out} sent, ${total - out} received — through ${rows}${composer}${tail}`
}
