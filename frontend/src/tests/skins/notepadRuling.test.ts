import { describe, expect, it } from 'vitest'

import { imgFrameBox, renderedImgRect } from '../../skins/comic-book/editor/transforms'
import { PANEL_IMG_TRANSFORMS } from '../../skins/comic-book/editor/layoutConfig'
import { panelDrawOrder } from '../../skins/comic-book/imageDepth'
import { bandBounds } from '../../skins/comic-book/tableData'
import { applyHomography, quadPx, unitHomography } from '../../skins/comic-book/tableProjection'
import { SKIN_CSS, cssRules } from './skinCss'

/**
 * The shipped call-record surface, checked against the ruling drawn in the picture it is
 * projected onto, and the hand that stands in front of it.
 *
 * The rows land on the lines in `raw notepad.webp` for one reason and it is not a happy
 * accident: *Fit to ruled lines* set the quad and recorded where each band's foot falls.
 * Get that wrong and rows sit between lines, which reads as a rendering bug and is a
 * framing one.
 *
 * The positions below were measured off the artwork's own pixels — the centre of each
 * blue run, walking the single column x = 610 of the 1140 × 1380 WebP, the middle of the
 * ruled area — and not by the detector the layout came from, so this is a second opinion
 * on the fit and not the fit read back. They are stated here rather than re-derived
 * because a test that decoded a WebP would be testing an image decoder.
 *
 * If the artwork is ever replaced, re-measure and change them in the same commit as the
 * picture; a new drawing with different ruling is not a failure of the quad.
 */

/** The notepad's own pixel size — the space the quad's percentages are fractions of. */
const NOTEPAD = { w: 1140, h: 1380 }
/** The hand's own pixel size. */
const HAND = { w: 408, h: 1102 }
/** The tip of the pen, in the hand's own pixels: the point that has to stay on the page. */
const PEN_TIP = { x: 15, y: 70 }
/** Centre of every ruled line at x = 610, top to bottom. */
const RULES = [
  193, 254, 315, 377, 437, 499, 560, 621.5, 684, 747, 808, 871, 931, 993, 1055, 1117, 1179, 1240,
]
/** How far a band's foot may miss its line, in artwork px: about 2.5% of a band. */
const FOOT_TOLERANCE = 1.5

/*
 * The panel's box in each window shape, as drawn. Stated rather than derived from the
 * grids because the claim is about the three boxes an author actually gets, and these are
 * different enough in aspect to separate two pictures framed as percentages of them.
 */
const PANEL_BOXES = {
  landscape: { w: 419, h: 536 },
  square: { w: 448, h: 536 },
  portrait: { w: 295, h: 575 },
}

const notepad = PANEL_IMG_TRANSFORMS.find(t => t.src.endsWith('raw%20notepad.webp'))!
const hand = PANEL_IMG_TRANSFORMS.find(t => t.src.endsWith('raw%20hand.webp'))!
const table = notepad.table!

describe('the shipped notepad surface', () => {
  it('is a surface, and is the call feed', () => {
    expect(table).toBeDefined()
    expect(table.source).toBe('calls')
  })

  it('gives the drawing one band per ruled line', () => {
    expect(table.rows).toBe(RULES.length)
  })

  /*
   * Every band's foot, pushed through the quad into the artwork, not just the first and
   * the last: the drawn pitch is not even, so a surface can have both ends right and the
   * middle a tenth of a band adrift. Equal bands on this quad miss by more than the
   * tolerance, which is what keeps `table.lines` from being dropped unnoticed.
   */
  it('lands every band foot on the line drawn in the picture', () => {
    const map = unitHomography(quadPx(table.quad, NOTEPAD.w, NOTEPAD.h))!
    const feet = bandBounds(table).slice(1)
    RULES.forEach((rule, k) => {
      const [, y] = applyHomography(map, 0.5, feet[k]!)
      expect(Math.abs(y - rule), `line ${k}`).toBeLessThan(FOOT_TOLERANCE)
    })
  })
})

describe('the hand in front of the notepad', () => {
  it('is a separate picture that carries no surface of its own', () => {
    expect(hand.panel).toBe(notepad.panel)
    expect(hand.table).toBeUndefined()
    expect(hand.numberPad).toBeUndefined()
  })

  // `spill` picks the layer and depth orders within it (imageDepth.ts), so a difference
  // in either puts the rows' lettering back over the hand.
  it('paints after the notepad, and so over its rows', () => {
    expect(hand.spill).toBe(notepad.spill)
    expect(hand.z).toBeGreaterThan(notepad.z)
    const order = panelDrawOrder(PANEL_IMG_TRANSFORMS, notepad.panel, null).map(d => d.img)
    expect(order.indexOf(hand)).toBeGreaterThan(order.indexOf(notepad))
  })

  /*
   * The two are framed as percentages of the panel, and a window shape changes the
   * panel's aspect, so they can come apart in a way the composite they replace never
   * could. With the hand anchored at its frame's centre the portrait panel dropped it to
   * the foot of the panel, a fingertip showing and the rest cut off by the ink: hence the
   * last line, because a pen can be on the page with no hand left in view.
   */
  it.each(Object.entries(PANEL_BOXES))('keeps the hand on the page in a %s panel', (_, box) => {
    const page = renderedImgRect(imgFrameBox(box, notepad), NOTEPAD, notepad)
    const drawn = renderedImgRect(imgFrameBox(box, hand), HAND, hand)
    const x = drawn.x + (PEN_TIP.x / HAND.w) * drawn.w
    const y = drawn.y + (PEN_TIP.y / HAND.h) * drawn.h
    expect(x).toBeGreaterThan(page.x)
    expect(x).toBeLessThan(page.x + page.w)
    expect(y).toBeGreaterThan(page.y)
    expect(y).toBeLessThan(page.y + page.h)
    expect(y).toBeLessThan(box.h * 0.9)
  })

  /*
   * The frame in front of the rows is a rectangle, mostly transparent. If it took the
   * pointer, the rows under it would lose their wash and the wheel across the whole of
   * the frame, and nothing would look wrong until somebody tried. jsdom does no hit
   * testing, so the rule is read from the stylesheet.
   */
  it('lets the pointer through to the rows behind it', () => {
    const clips = Object.values(SKIN_CSS)
      .flatMap(cssRules)
      .filter(rule => rule.selector === '.cb-img-clip')
    expect(clips.map(rule => rule.body).join('')).toMatch(/pointer-events:\s*none/)
  })
})
