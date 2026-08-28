/**
 * The three bouncing dots of a peer mid-composition, drawn inside their balloon where the
 * words will be. Purely decorative — the balloon that hosts it is already `aria-hidden` —
 * and animated entirely in CSS (see `.cb-typing` in bubbleChains.css), so this is markup
 * and nothing else.
 */
export default function BubbleTypingDots() {
  return (
    <span className="cb-typing" aria-hidden="true">
      <span className="cb-typing-dot" />
      <span className="cb-typing-dot" />
      <span className="cb-typing-dot" />
    </span>
  )
}
