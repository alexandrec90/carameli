// The comic caret: when the dial field's slanted ink block shows, and where it sits.
// The native caret is transparent (bubbleDial.css) — a 1px I-beam over hand-lettering
// reads as a form pasted onto the artwork — so useDialCaret.ts draws this one instead.
// The arithmetic is here, pure, so it can be tested without a canvas or a layout.

/**
 * Shown only for a collapsed selection in a focused field. A range selection paints
 * itself (::selection ink), so a block caret on top of it would be a second highlight.
 */
export function dialCaretShown(
  focused: boolean,
  start: number | null,
  end: number | null,
): boolean {
  return focused && start !== null && start === end
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
