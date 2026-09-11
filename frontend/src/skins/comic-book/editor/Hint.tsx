interface HintProps {
  /**
   * The explanation, in full. It is the tooltip verbatim — never a shortened version of a
   * longer paragraph, because there is nowhere else for the rest of it to be read.
   */
  text: string
}

/**
 * One paragraph of the inspector's prose, as a `?` beside the control it explains.
 *
 * The inspector used to say all of this in `.cb-ed-hint` blocks, and a picture carrying a
 * projected table stacked about twenty lines of them between the fields. That is not a
 * cosmetic problem: `useToolbarColumns` answers a tall toolbar by *widening* it, so the
 * prose is what turned the control panel into three columns across most of the page — the
 * author lost the drawing to read advice about it.
 *
 * The text itself is not dropped. Everything a hint block said is still here, in the
 * badge's `title` and its `aria-label`, so hovering reads it and a screen reader announces
 * it; what changes is that it costs a 14px badge on a line that already exists instead of
 * a paragraph of its own. The editor is dev-only and desktop-only (`import.meta.env.DEV`,
 * see EditorOverlay.tsx), so a native tooltip is a fair place to put it — there is no
 * touch surface here that would never be given one.
 *
 * A hint an author has to *act* on is not this. A refused split, a bound conversation with
 * no number to bind to, and the stale-file notices stay on the page as blocks, because a
 * warning nobody hovers is a warning nobody reads.
 */
export default function Hint({ text }: HintProps) {
  return (
    <span className="cb-ed-hint-mark" role="note" title={text} aria-label={text}>
      ?
    </span>
  )
}
