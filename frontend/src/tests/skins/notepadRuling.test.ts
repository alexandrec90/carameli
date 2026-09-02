import { describe, expect, it } from 'vitest'

import { PANEL_IMG_TRANSFORMS } from '../../skins/comic-book/editor/layoutConfig'

/**
 * The shipped call-record surface, checked against the ruling drawn in the picture it is
 * projected onto.
 *
 * The rows land on the lines in `hand-notepad.webp` for one reason and it is not a happy
 * accident: the surface is divided into `rows` equal bands, so the quad has to be seated
 * with its bottom edge *on* the last ruled line and its top edge exactly one band above the
 * first. Get that wrong and every row is off by the same fraction of a band — which reads
 * as a rendering bug and is a framing one, and which is what the quad shipped before this
 * test did (its foot sat a whole band below the last line).
 *
 * The constants below were measured off the artwork's own pixels — the blue channel of
 * `frontend/public/comic-book/hand-notepad.webp`, 939 × 1408, scanned column by column:
 * twenty-two ruled lines, the first at y ≈ 124.7 and the last at y ≈ 813.6 at the x the
 * quad's left edge sits at, evenly spaced at 32.8 px. They are stated here rather than
 * re-derived because a test that decoded a WebP would be testing an image decoder.
 *
 * If the artwork is ever replaced, re-measure and change these three numbers in the same
 * commit as the picture; a new photograph with different ruling is not a failure of the
 * quad.
 */

/** The picture's own pixel height — the frame the two positions below are fractions of. */
const ART_HEIGHT = 1408
/** Centre of the first ruled line, at the x the quad's left edge sits at. */
const FIRST_RULE = 124.7
/** Centre of the last one. */
const LAST_RULE = 813.6
/** Ruled lines in the drawing, which is what the row count has to be. */
const RULE_COUNT = 22

/** Where a band's foot sits down the picture, in % of the picture's height. */
function bandFoot(top: number, bottom: number, rows: number, k: number): number {
  return top + ((bottom - top) * k) / rows
}

describe('the shipped notepad surface', () => {
  const notepad = PANEL_IMG_TRANSFORMS.find(t => t.src.includes('hand-notepad'))
  const table = notepad?.table

  it('is a surface, and is the call feed', () => {
    expect(table).toBeDefined()
    expect(table?.source).toBe('calls')
  })

  it('gives the drawing one band per ruled line', () => {
    expect(table?.rows).toBe(RULE_COUNT)
  })

  /*
   * Both edges of the quad are checked, not just the span: a quad of the right *height* in
   * the wrong place puts every row between two lines, which is the failure that looks like
   * the projection itself is broken.
   */
  it('seats its bands on the lines drawn in the picture', () => {
    const top = table!.quad[0][1]
    const bottom = table!.quad[3][1]
    const pct = (y: number) => (y / ART_HEIGHT) * 100
    // A tenth of a percent of the picture is ~1.4 px of artwork, ~4% of a band.
    expect(bandFoot(top, bottom, RULE_COUNT, 1)).toBeCloseTo(pct(FIRST_RULE), 1)
    expect(bandFoot(top, bottom, RULE_COUNT, RULE_COUNT)).toBeCloseTo(pct(LAST_RULE), 1)
  })
})
