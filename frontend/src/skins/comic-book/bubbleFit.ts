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
// **Width first, then height.** A message grows its balloon sideways until the column is
// full, and only then wraps and grows it *tall* — a stretched ellipse, see `stretch` — so
// a short reply is a small round balloon and a paragraph is a full-column tall one, which
// is the proportion a letterer would choose.
//
// A chain's **composer** is fitted by the same arithmetic against what is being typed into
// it right now ({@link fitComposer}), so the field a reader is filling grows with its own
// words instead of scrolling them sideways out of a balloon that cannot follow.

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
 * the two callers that already know how wide the balloon is.
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
 * Fit `text` into a balloon of type `type` whose column is `column` % wide and whose
 * narrowest allowed balloon is `min` %.
 *
 * Width is what one line of the message needs, clamped into `[min, column]`; height is
 * whatever the wrap at that width then asks for, as a stretch of the box. A message that
 * fits its column on one line has `stretch` 1 — the balloon this replaces — and no
 * message is ever narrower than `min`, because a two-letter reply still needs to read as
 * a balloon rather than a dot.
 */
export function fitMessage(
  text: string,
  type: BubbleType,
  column: number,
  min: number,
  m: FitMetrics,
): BubbleFit {
  const glyph = GLYPH_EM[type] * m.lettering
  const usable = 1 - 2 * textInset(type).side
  const chars = text.trim().replace(/\s+/g, ' ').length
  const oneLine = m.boxW > 0 ? ((chars * glyph) / usable / m.boxW) * 100 : 0
  const width = Math.min(column, Math.max(min, oneLine))
  return { width, stretch: stretchFor(text, type, width, m) }
}

/**
 * Fit a chain's composer around the draft someone is typing into it.
 *
 * **Width is the author's, not the draft's** — the one way this differs from
 * {@link fitMessage}, and the difference is that a composer is a *target*. A message is
 * finished, so it may be as narrow as its words; a field that shrank to what had been
 * typed so far would move out from under the pointer between keystrokes, and an empty one
 * would be the dot {@link fitMessage}'s `min` exists to prevent. So the field stays the
 * width the author drew the template and only its height answers to the draft — which is
 * also the direction it can grow without leaving its column.
 *
 * It grows *upward*, because `placeRows` puts the composer on its template's tail tip
 * (chainAnchor.ts): the tail stays on the point the author aimed it at and the messages
 * above make room, which is where a phone's composer grows too.
 */
export function fitComposer(
  draft: string,
  type: BubbleType,
  width: number,
  m: FitMetrics,
): BubbleFit {
  return { width, stretch: stretchFor(draft, type, width, m) }
}
