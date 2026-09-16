// The comic caret: when a balloon field's slanted ink block shows, and where it sits.
// The native caret is transparent (bubbleInputs.css) — a 1px I-beam over hand-lettering
// reads as a form pasted onto the artwork — so useDialCaret.ts draws this one instead.
// The arithmetic is here, pure, so it can be tested without a canvas or a layout.
//
// A dial's number is one line, so where the caret sits is one number: {@link dialCaretLeft}
// along the centred line. A chain's composer wraps (BubbleInput's `wraps`), so it is two —
// which of the drawn lines the caret is on, and how far along that one — and the first of
// those needs to know where the browser broke the words: {@link wrapCaretLines}.

/**
 * Shown exactly where typing would append: a collapsed selection in a focused field
 * whose number is the reader's own. A caret is a promise about the next keystroke, and
 * over a fresh, drum-supplied number that promise is false — the next key replaces the
 * number whole (see BubbleDial's `fresh`), so blinking mid-number there would point at
 * an insertion that can never happen. A range selection paints itself (::selection
 * ink), so a block caret on top of it would be a second highlight.
 */
export function dialCaretShown(
  focused: boolean,
  fresh: boolean,
  start: number | null,
  end: number | null,
): boolean {
  return focused && !fresh && start !== null && start === end
}

/**
 * Left edge of the caret in px from the field's border edge. The field centres its
 * text, so the caret sits at the centred line's left edge plus the width of what
 * precedes the caret — both widths measured by the caller in the field's own font.
 */
export function dialCaretLeft(
  padLeft: number,
  contentWidth: number,
  textWidth: number,
  beforeWidth: number,
): number {
  return padLeft + (contentWidth - textWidth) / 2 + beforeWidth
}

/** One line of a wrapping field as it was drawn. */
export interface CaretLine {
  /** Index in the value of the line's first character. */
  start: number
  /** The line's text, trailing spaces dropped the way a centred line hangs them. */
  text: string
}

/**
 * Break `value` into the lines a field `width` px wide draws it on, `measure` giving a
 * run's width in the field's own lettering.
 *
 * Greedy at spaces, and inside a word too long for a line of its own, which is what
 * `overflow-wrap: anywhere` does — the same two rules `wrapLines` in bubbleFit.ts follows.
 * **That it measures where `wrapLines` counts average glyphs is the whole difference
 * between them, and it is the difference between the two questions.** `wrapLines` sizes
 * the *balloon* before a word of it is drawn, from the frame alone, so it estimates and
 * errs roomy — a balloon with air in it is a balloon. This finds the line a caret is
 * standing on in text the browser has already laid out, where erring roomy would simply
 * put the caret on the wrong line, so it measures the real glyphs instead.
 *
 * A trailing space never pushes a line over: browsers hang it past the edge and leave it
 * out of the centring, so it is dropped from `text` here for the same reason.
 */
export function wrapCaretLines(
  value: string,
  width: number,
  measure: (run: string) => number,
): CaretLine[] {
  const lines: CaretLine[] = []
  let start = 0
  // The last point on the current line the browser could break at: just after a space.
  let breakAt = -1
  const push = (to: number): void => {
    lines.push({ start, text: value.slice(start, to).replace(/\s+$/, '') })
    start = to
    breakAt = -1
  }
  for (let i = 0; i < value.length; i += 1) {
    const space = value[i] === ' '
    const over = measure(value.slice(start, i + 1).replace(/\s+$/, '')) > width
    // Break before the character that would not fit: at the last space if the line has
    // one, and otherwise mid-word, which is where `overflow-wrap: anywhere` breaks.
    if (!space && over && i > start) push(breakAt > start ? breakAt : i)
    if (space) breakAt = i + 1
  }
  push(value.length)
  return lines
}

/**
 * Which of `lines` the caret at index `at` stands on — the last one that starts at or
 * before it, so a caret at a wrap lands at the head of the new line rather than past the
 * end of the old one, which is where the next character typed will appear.
 */
export function caretLineIndex(lines: readonly CaretLine[], at: number): number {
  let index = 0
  for (let i = 0; i < lines.length; i += 1) if (lines[i].start <= at) index = i
  return index
}

/**
 * Top edge of the caret's own line in a field that wraps, in px from the field's border
 * edge: the padding, then a whole line per line above it.
 */
export function caretLineTop(padTop: number, lineHeight: number, line: number): number {
  return padTop + line * lineHeight
}
