import { describe, expect, it } from 'vitest'

import { BUBBLE_ASPECT, BUBBLE_ELLIPSE_N } from '../../skins/comic-book/bubbleBox'
import {
  GLYPH_EM, LINE_HEIGHT, TEXT_BAND, TEXT_INSET, fitMessage, glyphsPerLine, textBand, wrapLines,
} from '../../skins/comic-book/bubbleFit'
import type { FitMetrics } from '../../skins/comic-book/bubbleFit'
import { BUBBLE_TYPE_KEYS } from '../../skins/comic-book/editor/bubbleTypes'
import { cssRules, SKIN_CSS } from './skinCss'

// The text-fit estimate: how wide a balloon a message wants, and how much taller than its
// aspect it has to be drawn once the words wrap. Nothing here measures text, so the
// assertions are about the estimate's *shape* — monotone in the message, bounded by the
// column, generous rather than tight — and about it agreeing with the CSS it estimates.

/** A box four hundred wide, lettered at twelve: a 40% column holds about seventeen glyphs. */
const M: FitMetrics = { boxW: 400, lettering: 12 }

describe('TEXT_INSET and LINE_HEIGHT', () => {
  // The estimate wraps at the width the stylesheet gives the words. If the two drift, the
  // balloon is sized for a wrap that never happens.
  it('mirror the .cb-panel-bubble-text rule in bubbles.css', () => {
    const css = SKIN_CSS['src/skins/comic-book/bubbles.css']
    const rule = cssRules(css).find(r => r.selector === '.cb-panel-bubble-text')
    const inset = rule?.body.match(/inset\s*:\s*(\d+)%\s+(\d+)%\s+(\d+)%\s*;/)
    expect(inset).toBeTruthy()
    expect(Number(inset?.[1]) / 100).toBe(TEXT_INSET.top)
    expect(Number(inset?.[2]) / 100).toBe(TEXT_INSET.side)
    expect(Number(inset?.[3]) / 100).toBe(TEXT_INSET.bottom)
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
  it('is no taller than the inset allows', () => {
    expect(textBand()).toBeLessThanOrEqual(1 - TEXT_INSET.top - TEXT_INSET.bottom)
  })

  // The lettering block's corners must stay inside the ellipse: at the block's width the
  // ellipse is only so tall, and that chord is the band.
  it('keeps a block of the lettering’s width inside the ellipse', () => {
    const halfText = (1 - 2 * TEXT_INSET.side) / 2
    const halfBand = textBand() / 2
    const inside =
      (halfText / BUBBLE_ELLIPSE_N.rx) ** 2 + (halfBand / BUBBLE_ELLIPSE_N.ry) ** 2
    expect(inside).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('is what TEXT_BAND holds', () => {
    expect(TEXT_BAND).toBe(textBand())
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
    const usablePx = (40 / 100) * M.boxW * (1 - 2 * TEXT_INSET.side)
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
    expect(stretch).toBeCloseTo(Math.max(1, need / (TEXT_BAND * boxH)), 9)
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
