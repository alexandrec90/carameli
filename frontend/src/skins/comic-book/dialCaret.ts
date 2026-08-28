// The comic caret: when the dial field's slanted ink block shows, and where it sits.
// The native caret is transparent (bubbleDial.css) — a 1px I-beam over hand-lettering
// reads as a form pasted onto the artwork — so useDialCaret.ts draws this one instead.
// The arithmetic is here, pure, so it can be tested without a canvas or a layout.

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
