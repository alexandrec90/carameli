import type { BubbleTransform } from './editor/types'

// How a balloon's size follows the window, and why it is not simply its `width` %.
//
// A picture is contain-fitted into its frame, so on any landscape panel it is the
// panel's *height* that bounds it: stretch the window sideways and the picture stays the
// size it was. A balloon was a % of its panel's *width* and nothing else, so the same
// stretch grew it without limit — across two monitors it was taller than its panel, and
// several times the telephone it was drawn beside. The two were never on the same scale.
//
// The fix is a single page-level factor rather than a per-balloon cap: the box cannot be
// capped on its own, because its tail, its chain rows, its tube welds and its editor hit
// box are all measured from that width. Applied once where the balloons leave the config
// (Layout, and the editor for its targets), every one of those consumers sees the same
// rendered width and stays in agreement.

/**
 * The page aspect ratio (width / height) above which balloons stop following the width
 * and follow the height instead. Chosen just above the ratio the balloons were drawn at —
 * a 1920 × 1017 window — so nothing changes there or on anything narrower: an ordinary
 * 16:9 window, a portrait one, a phone. Past it, a wider window is treated as the same
 * page with room to spare on either side, which is what a picture already does.
 *
 * The lettering token in `comic-book.css` encodes the same ratio, as the `vh` term of its
 * `min()`; `bubbleLettering.test.ts` holds the two together. 1.92 rather than a rounder
 * number because that term is the vw slope times this, and stylelint allows it four
 * decimals: 0.9375 × 1.92 is exactly 1.8.
 */
export const PAGE_FIT_ASPECT = 1.92

/**
 * The factor a balloon's `width` % is scaled by on a `w` × `h` window: 1 up to
 * {@link PAGE_FIT_ASPECT}, then falling as the window widens so the balloon keeps the size
 * it would have at that ratio. A viewport with no size yet (first paint) fits at 1, the
 * value that draws the config exactly as authored.
 */
export function pageFit(w: number, h: number): number {
  if (w <= 0 || h <= 0) return 1
  return Math.min(1, (PAGE_FIT_ASPECT * h) / w)
}

/** One balloon at its rendered width. Placement is untouched: only the size fits. */
export function fitBubble<T extends Pick<BubbleTransform, 'width'>>(bubble: T, fit: number): T {
  return fit === 1 ? bubble : { ...bubble, width: bubble.width * fit }
}

/**
 * Every balloon at its rendered width. The same array back when nothing changes, so a
 * consumer keyed on the list's identity does not re-lay itself out on every render.
 */
export function fitBubbles<T extends Pick<BubbleTransform, 'width'>>(
  bubbles: T[],
  fit: number,
): T[] {
  return fit === 1 ? bubbles : bubbles.map(b => fitBubble(b, fit))
}
