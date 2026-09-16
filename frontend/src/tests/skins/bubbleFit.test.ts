import { describe, expect, it } from 'vitest'

import { BUBBLE_ASPECT, BUBBLE_ELLIPSE_N } from '../../skins/comic-book/bubbleBox'
import {
  GLYPH_EM, LINE_HEIGHT, fitComposer, fitMessage, glyphsPerLine, stretchFor, textBand,
  wrapLines,
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

describe('fitMessage', () => {
  const fitAt = (text: string, over: Partial<FitMetrics> = {}) =>
    fitMessage(text, 'soft', 40, 40 * 0.42, { ...M, ...over })

  it('gives an empty message the narrowest balloon its column allows', () => {
    expect(fitAt('')).toEqual({ width: 40 * 0.42, stretch: 1 })
  })

  it('grows with the message, so a conversation has a ragged edge', () => {
    expect(fitAt('hi').width).toBeLessThanOrEqual(fitAt('hi there').width)
    expect(fitAt('hi there').width).toBeLessThan(fitAt('hi there, you around?').width)
  })

  it('fills the column and stops there, growing tall instead', () => {
    const long = fitAt('a message long enough to fill the column and then some more')
    expect(long.width).toBe(40)
    expect(long.stretch).toBeGreaterThan(1)
  })

  it('keeps a message that fits one line at the balloon’s ordinary aspect', () => {
    expect(fitAt('yes').stretch).toBe(1)
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
    const word = fitAt('w'.repeat(60))
    expect(word.width).toBe(40)
    expect(word.stretch).toBeGreaterThan(1)
    expect(wrapLines('w'.repeat(60), glyphsPerLine(40, 'soft', M)).length).toBeGreaterThan(1)
  })

  it('never goes below the narrowest, however small the lettering', () => {
    expect(fitAt('a', { lettering: 1 }).width).toBe(40 * 0.42)
  })

  it('takes a column narrower than the minimum as the minimum', () => {
    expect(fitMessage('hello there', 'soft', 10, 16, M).width).toBe(10)
  })

  it('falls back to the narrowest, unstretched balloon with nothing to measure against', () => {
    expect(fitAt('a long message with no lettering size', { lettering: 0 })).toEqual({
      width: 40 * 0.42,
      stretch: 1,
    })
    expect(fitAt('a long message in a box with no width', { boxW: 0 })).toEqual({
      width: 40 * 0.42,
      stretch: 1,
    })
  })

  it('letters wider faces into wider balloons', () => {
    const soft = fitMessage('hello there', 'soft', 60, 10, M)
    const cloud = fitMessage('hello there', 'cloud', 60, 10, M)
    expect(cloud.width).toBeGreaterThan(soft.width)
  })
})

describe('fitComposer', () => {
  const composer = (draft: string, over: Partial<FitMetrics> = {}) =>
    fitComposer(draft, 'soft', 40, { ...M, ...over })

  // The difference from fitMessage, and the reason there are two functions: a field is a
  // target. One that shrank to what had been typed so far would move out from under the
  // pointer between keystrokes, and an empty one would be a dot rather than an invitation.
  it('keeps the author’s width whatever is typed into it', () => {
    expect(composer('').width).toBe(40)
    expect(composer('hi').width).toBe(40)
    expect(composer('a message long enough to wrap onto several lines of it').width).toBe(40)
  })

  it('draws an empty composer at the balloon the author placed', () => {
    expect(composer('')).toEqual({ width: 40, stretch: 1 })
  })

  it('grows taller as the draft wraps, so the words stay inside the ink', () => {
    const short = composer('hi')
    const long = composer('a message long enough to wrap onto several lines of it')
    expect(short.stretch).toBe(1)
    expect(long.stretch).toBeGreaterThan(1)
    expect(composer(`${'w'.repeat(200)}`).stretch).toBeGreaterThan(long.stretch)
  })

  it('shrinks back when the draft is sent and the field empties', () => {
    expect(composer('a message long enough to wrap onto several lines of it').stretch)
      .toBeGreaterThan(1)
    expect(composer('').stretch).toBe(1)
  })

  it('asks for the same height a message of the same words at that width would', () => {
    const draft = 'a message long enough to wrap onto several lines of it'
    expect(composer(draft).stretch).toBeCloseTo(stretchFor(draft, 'soft', 40, M), 9)
  })

  it('stays unstretched with nothing to measure against', () => {
    expect(composer('a long draft', { lettering: 0 })).toEqual({ width: 40, stretch: 1 })
    expect(composer('a long draft', { boxW: 0 })).toEqual({ width: 40, stretch: 1 })
  })
})
