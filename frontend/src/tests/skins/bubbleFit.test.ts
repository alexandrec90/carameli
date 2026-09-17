import { describe, expect, it } from 'vitest'

import { BUBBLE_ASPECT, BUBBLE_ELLIPSE_N } from '../../skins/comic-book/bubbleBox'
import {
  GLYPH_EM, GROW_BIAS, LINE_HEIGHT, biasedStretch, fitMessage, glyphsPerLine, stretchFor,
  textBand, wrapLines,
} from '../../skins/comic-book/bubbleFit'
import type { FitMetrics } from '../../skins/comic-book/bubbleFit'
import { textInset } from '../../skins/comic-book/bubbleText'
import { BUBBLE_TYPE_KEYS } from '../../skins/comic-book/editor/bubbleTypes'
import { cssRules, SKIN_CSS } from './skinCss'

// The text-fit estimate: how wide a balloon a message wants, and how much taller than its
// aspect it has to be drawn once the words wrap. Nothing here measures text, so the
// assertions are about the estimate's *shape* — monotone in the message, bounded by the
// column, generous rather than tight — and about it agreeing with the CSS it estimates.

/** A box four hundred wide, lettered at twelve: a 40% column holds about seventeen glyphs. */
const M: FitMetrics = { boxW: 400, lettering: 12 }

describe('LINE_HEIGHT', () => {
  // The estimate stacks lines at the height the stylesheet gives them. If the two drift,
  // the balloon is sized for a column that never happens. (The inset the estimate wraps
  // at is not mirrored: both the estimate and the drawing read it from bubbleText.ts.)
  it('mirrors the .cb-panel-bubble-text rule in bubbles.css', () => {
    const css = SKIN_CSS['src/skins/comic-book/bubbles.css']
    const rule = cssRules(css).find(r => r.selector === '.cb-panel-bubble-text')
    const lineHeight = rule?.body.match(/line-height\s*:\s*([\d.]+)\s*;/)
    expect(Number(lineHeight?.[1])).toBe(LINE_HEIGHT)
  })
})

describe('GLYPH_EM', () => {
  it('names an advance for every bubble type, all plausibly wide', () => {
    for (const type of BUBBLE_TYPE_KEYS) {
      expect(GLYPH_EM[type]).toBeGreaterThan(0.3)
      expect(GLYPH_EM[type]).toBeLessThan(1)
    }
  })
})

describe('textBand', () => {
  it('is no taller than the inset allows, for every type', () => {
    for (const type of BUBBLE_TYPE_KEYS) {
      const { top, bottom } = textInset(type)
      expect(textBand(type)).toBeLessThanOrEqual(1 - top - bottom)
    }
  })

  // The lettering block's corners must stay inside the ellipse: at the block's width the
  // ellipse is only so tall, and that chord is the band.
  it('keeps a block of the lettering’s width inside the ellipse', () => {
    for (const type of BUBBLE_TYPE_KEYS) {
      const halfText = (1 - 2 * textInset(type).side) / 2
      const halfBand = textBand(type) / 2
      const inside =
        (halfText / BUBBLE_ELLIPSE_N.rx) ** 2 + (halfBand / BUBBLE_ELLIPSE_N.ry) ** 2
      expect(inside).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  // The block is inscribed in the ellipse, so the chord at its width *is* its height and
  // the band is the whole inset. A band short of it would be air the words cannot use.
  it('fills the inset for the plain ellipse', () => {
    const { top, bottom } = textInset('soft')
    expect(textBand('soft')).toBeCloseTo(1 - top - bottom, 9)
  })
})

describe('wrapLines', () => {
  it('fills each line greedily on word boundaries', () => {
    expect(wrapLines('the quick brown fox', 9)).toEqual(['the quick', 'brown fox'])
  })

  it('breaks a word longer than a line after starting a fresh one, as overflow-wrap: anywhere does', () => {
    expect(wrapLines('hi sunflower', 3)).toEqual(['hi', 'sun', 'flo', 'wer'])
    expect(wrapLines('sunflowers', 3)).toEqual(['sun', 'flo', 'wer', 's'])
  })

  it('collapses runs of whitespace and ignores the ends', () => {
    expect(wrapLines('  a   b  ', 3)).toEqual(['a b'])
  })

  it('is empty for an empty message', () => {
    expect(wrapLines('   ', 5)).toEqual([])
  })

  it('never wraps at an infinite line', () => {
    expect(wrapLines('one two three', Number.POSITIVE_INFINITY)).toEqual(['one two three'])
  })
})

describe('glyphsPerLine', () => {
  it('counts what the inset leaves of the balloon, in glyph advances', () => {
    const usablePx = (40 / 100) * M.boxW * (1 - 2 * textInset('soft').side)
    expect(glyphsPerLine(40, 'soft', M)).toBe(Math.floor(usablePx / (GLYPH_EM.soft * M.lettering)))
  })

  it('is infinite with no lettering, so nothing wraps', () => {
    expect(glyphsPerLine(40, 'soft', { ...M, lettering: 0 })).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('GROW_BIAS', () => {
  // Above zero a balloon leans tall as it inflates; at one its height would grow as the
  // square of its width, a pillar. Either end is a balloon nobody would letter.
  it('leans tall without turning a balloon into a pillar', () => {
    expect(GROW_BIAS).toBeGreaterThan(0)
    expect(GROW_BIAS).toBeLessThan(1)
  })

  it('allows the narrowest balloon no stretch, and more the wider it inflates', () => {
    expect(biasedStretch(1)).toBe(1)
    expect(biasedStretch(2)).toBeGreaterThan(biasedStretch(1.5))
    expect(biasedStretch(2)).toBeLessThan(2)
  })
})

describe('fitMessage', () => {
  const COLUMN = 40
  const MIN = 40 * 0.42
  const fitAt = (text: string, over: Partial<FitMetrics> = {}) =>
    fitMessage(text, 'soft', COLUMN, MIN, { ...M, ...over })
  /** The width one unwrapped line of `text` would take, the old fit's first answer. */
  const oneLine = (text: string) =>
    ((text.length * GLYPH_EM.soft * M.lettering) / (1 - 2 * textInset('soft').side) / M.boxW) * 100

  it('gives an empty message the narrowest balloon its column allows', () => {
    expect(fitAt('')).toEqual({ width: MIN, stretch: 1 })
  })

  it('keeps a message that fits one line of the narrowest balloon at its ordinary aspect', () => {
    expect(fitAt('yes')).toEqual({ width: MIN, stretch: 1 })
  })

  // A balloon, not a caption: a message a little too long for the narrowest balloon
  // widens it *and* stretches it, and wraps, rather than widening to a one-line strip.
  it('inflates in both directions at once, wrapping rather than stretching into a strip', () => {
    const text = 'hi there, you around?'
    const { width, stretch } = fitAt(text)
    expect(width).toBeGreaterThan(MIN)
    expect(width).toBeLessThan(COLUMN)
    expect(stretch).toBeGreaterThan(1)
    expect(wrapLines(text, glyphsPerLine(width, 'soft', M)).length).toBeGreaterThan(1)
    expect(width).toBeLessThan(oneLine(text))
  })

  // The fit is the *smallest* balloon whose wrap the bias allows: it never stretches past
  // what its width permits, and one hair narrower would have to.
  it('takes the smallest balloon whose wrap stays within the bias', () => {
    for (const text of ['hi there', 'hi there, you around?', 'hello there my old friend, how have you been']) {
      const { width, stretch } = fitAt(text)
      expect(stretch).toBeLessThanOrEqual(biasedStretch(width / MIN) + 1e-9)
      if (width < COLUMN) {
        const narrower = width * 0.999
        expect(stretchFor(text, 'soft', narrower, M)).toBeGreaterThan(biasedStretch(narrower / MIN))
      }
    }
  })

  it('grows with the message, so a conversation has a ragged edge', () => {
    expect(fitAt('hi').width).toBeLessThanOrEqual(fitAt('hi there').width)
    expect(fitAt('hi there').width).toBeLessThan(fitAt('hi there, you around?').width)
  })

  it('never shrinks as a message is extended a word at a time', () => {
    const words = 'a message long enough to fill the column and then some more'.split(' ')
    let last = { width: 0, stretch: 0 }
    for (let n = 1; n <= words.length; n += 1) {
      const fit = fitAt(words.slice(0, n).join(' '))
      expect(fit.width).toBeGreaterThanOrEqual(last.width - 1e-9)
      last = fit
    }
  })

  it('fills the column and stops there, growing tall instead', () => {
    const long = fitAt(
      'a message long enough to fill the column and then some more, and then more again after that',
    )
    expect(long.width).toBe(COLUMN)
    expect(long.stretch).toBeGreaterThan(biasedStretch(COLUMN / MIN))
  })

  it('asks for exactly the lines the wrap needs, over the band the ellipse allows', () => {
    const text = 'x'.repeat(10) + ' ' + 'y'.repeat(10) + ' ' + 'z'.repeat(10)
    const { width, stretch } = fitAt(text)
    const lines = wrapLines(text, glyphsPerLine(width, 'soft', M)).length
    const need = lines * LINE_HEIGHT * M.lettering
    const boxH = (width / 100) * M.boxW * BUBBLE_ASPECT
    expect(stretch).toBeCloseTo(Math.max(1, need / (textBand('soft') * boxH)), 9)
  })

  // The one-word case the wrap rule exists for: it neither crops nor keeps widening.
  it('wraps one long word inside a column-wide balloon rather than widening past it', () => {
    const word = fitAt('w'.repeat(120))
    expect(word.width).toBe(COLUMN)
    expect(word.stretch).toBeGreaterThan(1)
    expect(wrapLines('w'.repeat(120), glyphsPerLine(COLUMN, 'soft', M)).length).toBeGreaterThan(1)
  })

  it('never goes below the narrowest, however small the lettering', () => {
    expect(fitAt('a', { lettering: 1 }).width).toBe(MIN)
  })

  it('takes a column narrower than the minimum as the minimum', () => {
    expect(fitMessage('hello there', 'soft', 10, 16, M).width).toBe(10)
  })

  it('falls back to the narrowest, unstretched balloon with nothing to measure against', () => {
    expect(fitAt('a long message with no lettering size', { lettering: 0 })).toEqual({
      width: MIN,
      stretch: 1,
    })
    expect(fitAt('a long message in a box with no width', { boxW: 0 })).toEqual({
      width: MIN,
      stretch: 1,
    })
  })

  // Only the line count widens a balloon, so a wider face needs a wider balloon exactly
  // where its lines break sooner — never a narrower one.
  it('letters wider faces into balloons at least as wide', () => {
    const text = 'hi there, you around?'
    const soft = fitMessage(text, 'soft', 60, 10, M)
    const cloud = fitMessage(text, 'cloud', 60, 10, M)
    expect(cloud.width).toBeGreaterThan(soft.width)
    expect(fitMessage('hello there', 'cloud', 60, 10, M).width)
      .toBeGreaterThanOrEqual(fitMessage('hello there', 'soft', 60, 10, M).width)
  })
})
