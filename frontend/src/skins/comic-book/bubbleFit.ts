import { BUBBLE_ASPECT, BUBBLE_ELLIPSE_N } from './bubbleBox'
import { textInset } from './bubbleText'
import type { BubbleType } from './editor/bubbleTypes'

// How much balloon a message needs, worked out without measuring it.
//
// A chain row is stamped at render time from a template, and its size has to be known
// *before* it is drawn: the rows above it are placed by its height, and a two-pass
// measure-then-lay-out would move every balloon once the words had rendered. So the fit
// is an estimate — the same kind the rest of the skin makes, where nothing reads the DOM
// and everything is a share of the frame — and it errs roomy on purpose: a balloon with a
// little air in it is a balloon, a balloon its words poke out of is a mistake.
//
// The estimate needs two px numbers the layout already has: how wide the panel box is
// (what a width % resolves against) and how big the lettering is (`--cb-lettering`, a
// share of the frame height). Both arrive in {@link FitMetrics}; nothing here measures.
//
// **A balloon inflates.** A message grows its balloon in both directions at once, the way
// a balloon fills, leaning tall (`GROW_BIAS`): a short reply is a small round balloon, a
// longer one is a bigger and somewhat taller one, and only once it is as wide as its
// column does it grow *tall* alone — a stretched ellipse, see `stretch`. The earlier fit
// went wide first and then tall, and a thread of it was one-line captions until the column
// filled; a field fitted the same way, pinned to its column's width, only ever got taller,
// which is not what a balloon does when more is said into it.
//
// A chain's **composer** is fitted by the same arithmetic against what is being typed into
// it right now (`fitRow` in chainRows.ts), so the field a reader is filling grows with its
// own words instead of scrolling them sideways out of a balloon that cannot follow.

// The lettering block's inset is `textInset(type)` from bubbleText.ts — the rectangle the
// drawing letters into, read from the same place, so a fit computed against one inset and
// drawn inside another (which wraps at the wrong width) has no way to arise.

/**
 * Line height of the lettering, in em. **Mirrors `.cb-panel-bubble-text` in bubbles.css**,
 * and `bubbleFit.test.ts` holds the two together.
 */
export const LINE_HEIGHT = 1.2

/**
 * Average glyph advance in em for each type's lettering face (see `BUBBLE_TYPES`). These
 * are deliberately on the wide side of the real averages — Boogaloo is narrower than
 * this, Bangers narrower still — so a line the estimate says fits does fit, and the
 * cost of being wrong is air rather than an overflow.
 */
export const GLYPH_EM: Record<BubbleType, number> = {
  soft: 0.52,
  cloud: 0.64,
  lightning: 0.46,
}

/** The px the layout resolves against — the one thing the estimate cannot derive. */
export interface FitMetrics {
  /** Width of the panel box in px, what a bubble's width % is a share of. */
  boxW: number
  /** The resolved `--cb-lettering`, in px. Zero before the page has a frame. */
  lettering: number
}

/**
 * Share of the balloon box's height the lettering may fill in a balloon of `type`.
 *
 * Never more than the inset allows, and never more than the ellipse's vertical chord at
 * the lettering's *width* — as tall as the ellipse is where the lines are widest — so a
 * block that fills it keeps its corners inside the ink. The inset is inscribed in that
 * ellipse (bubbleText.ts), so today the two agree exactly; the chord stays as the guard
 * that would catch an inset retuned past it.
 */
export function textBand(type: BubbleType): number {
  const inset = textInset(type)
  const band = 1 - inset.top - inset.bottom
  const halfText = (1 - 2 * inset.side) / 2
  const ratio = halfText / BUBBLE_ELLIPSE_N.rx
  const chord = 2 * BUBBLE_ELLIPSE_N.ry * Math.sqrt(Math.max(0, 1 - ratio * ratio))
  return Math.min(band, chord)
}

/**
 * The lines `text` wraps into at `perLine` glyphs a line: greedy on words, and a word
 * longer than a line breaks mid-word after starting a fresh one, which is what
 * `overflow-wrap: anywhere` does with it. `Infinity` never wraps — the answer when there
 * is no lettering size to wrap against.
 */
export function wrapLines(text: string, perLine: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const width = Math.max(1, Math.floor(perLine))
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    let rest = word
    while (rest.length > width) {
      if (line) lines.push(line)
      line = ''
      lines.push(rest.slice(0, width))
      rest = rest.slice(width)
    }
    if (rest === '') continue
    if (!line) line = rest
    else if (line.length + 1 + rest.length <= width) line = `${line} ${rest}`
    else {
      lines.push(line)
      line = rest
    }
  }
  if (line) lines.push(line)
  return lines
}

/** A balloon sized to its message. */
export interface BubbleFit {
  /** Width in % of the panel box. */
  width: number
  /**
   * How much taller than its fixed aspect the balloon is drawn — 1 is the ordinary
   * `BUBBLE_ASPECT` box, 2 twice that height. PanelBubble stretches the outline SVG by
   * it, so every part of the balloon scales together: ellipse, tail, hit region, inset.
   */
  stretch: number
}

/** Glyphs that fit on one line of a balloon `widthPct` wide. Infinite without lettering. */
export function glyphsPerLine(widthPct: number, type: BubbleType, m: FitMetrics): number {
  const glyph = GLYPH_EM[type] * m.lettering
  if (glyph <= 0) return Number.POSITIVE_INFINITY
  const usable = (widthPct / 100) * m.boxW * (1 - 2 * textInset(type).side)
  return Math.floor(usable / glyph)
}

/**
 * How much taller than its box a balloon of `type` and `width`% must be drawn to hold
 * `text` wrapped at that width — the `stretch` of a {@link BubbleFit}, on its own, for
 * a caller that already knows how wide the balloon is.
 *
 * 1 whenever the wrap fits the type's lettering band, which includes a balloon with
 * nothing in it: no words is no reason to draw a taller balloon.
 */
export function stretchFor(
  text: string,
  type: BubbleType,
  width: number,
  m: FitMetrics,
): number {
  const lines = wrapLines(text, glyphsPerLine(width, type, m)).length
  const need = lines * LINE_HEIGHT * m.lettering
  const boxH = (width / 100) * m.boxW * BUBBLE_ASPECT
  return boxH > 0 ? Math.max(1, need / (textBand(type) * boxH)) : 1
}

/**
 * How much a balloon leans tall as it inflates: one grown to `k` times its narrowest
 * width may be `k ** GROW_BIAS` times taller than its aspect before it widens any
 * further. 0 would inflate uniformly — the same round balloon at every size — and 1 would
 * grow the height as the square of the width. Half leans tall without turning a balloon
 * into a pillar: the column is the scarce direction in a conversation, so a balloon
 * spends its words on height a little sooner than on width.
 */
export const GROW_BIAS = 0.5

/** Bisection steps for {@link fitMessage}: a width to within a millionth of the range. */
const GROW_STEPS = 20

/** The stretch a balloon inflated to `k` times its narrowest width may take before widening. */
export function biasedStretch(k: number): number {
  return k ** GROW_BIAS
}

/**
 * Fit `text` into a balloon of type `type` whose column is `column` % wide and whose
 * narrowest allowed balloon is `min` %.
 *
 * The balloon inflates from `min`: it is the smallest one, `k` times its narrowest width,
 * whose wrap at that width needs no more stretch than {@link biasedStretch} allows it, so
 * width and height grow together and the height a little faster. Once `k` reaches the
 * column the width stops there and the height is whatever the wrap then asks for. A
 * message that fits one line of the narrowest balloon has `stretch` 1 and `width` `min`,
 * and no message is ever narrower than `min`, because a two-letter reply still needs to
 * read as a balloon rather than a dot. A column narrower than `min` is the width.
 *
 * The search is a bisection over `k`: the wrap's stretch falls as the balloon widens and
 * the allowance rises, so the answer is one crossing, and the upper end always fits, so
 * the words stay inside the ink even where a greedy wrap is not quite monotone.
 */
export function fitMessage(
  text: string,
  type: BubbleType,
  column: number,
  min: number,
  m: FitMetrics,
): BubbleFit {
  const floor = Math.min(column, min)
  const reach = floor > 0 ? column / floor : 1
  const fits = (k: number): boolean =>
    stretchFor(text, type, floor * k, m) <= biasedStretch(k)
  let k = 1
  if (reach > 1 && !fits(1)) {
    if (fits(reach)) {
      let lo = 1
      let hi = reach
      for (let i = 0; i < GROW_STEPS; i += 1) {
        const mid = (lo + hi) / 2
        if (fits(mid)) hi = mid
        else lo = mid
      }
      k = hi
    } else {
      k = reach
    }
  }
  const width = floor * k
  return { width, stretch: stretchFor(text, type, width, m) }
}
