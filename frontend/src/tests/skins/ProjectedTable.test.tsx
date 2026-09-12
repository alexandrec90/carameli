import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ProjectedTable from '../../skins/comic-book/ProjectedTable'
import { BAND_SIT, WHEEL_ROW_PX } from '../../skins/comic-book/tableData'
import { cssRules, SKIN_CSS } from './skinCss'
import type { Quad } from '../../skins/comic-book/tableProjection'
import type { TableProjection } from '../../skins/comic-book/editor/types'

// The rendered surface. Two things are being defended here, and they are the two halves
// of what was asked for: outside the editor a reader sees values and nothing else — no
// outline, no guides, no bar — and a wheel moves whole rows, so the lettering never lands
// between the lines drawn in the picture.

// The picture's rendered rect — deliberately not at the wrapper's origin, so a test
// below can pin that the surface is placed at the artwork rather than at the frame.
const BASE = { x: 12, y: 8, w: 400, h: 300 }

function table(over: Partial<TableProjection> = {}): TableProjection {
  return {
    quad: [[10, 10], [90, 10], [90, 90], [10, 90]],
    rows: 5,
    header: true,
    columns: [
      { label: 'Name', width: 2, align: 'left' },
      { label: 'Number', width: 1, align: 'right' },
    ],
    data: Array.from({ length: 10 }, (_, i) => [`name ${i}`, `55${i}`]),
    fontScale: 0.5,
    ink: '#1b3a8f',
    ...over,
  }
}

function draw(over: Partial<TableProjection> = {}, editing = false) {
  const view = render(<ProjectedTable table={table(over)} base={BASE} editing={editing} />)
  const surface = view.container.querySelector('.cb-ptable-surface') as HTMLElement | null
  const names = () =>
    Array.from(view.container.querySelectorAll('tbody tr')).map(
      tr => tr.querySelector('td')?.textContent ?? '',
    )
  const rows = () => Array.from(view.container.querySelectorAll('tbody tr'))
  const band = () => view.container.querySelector('.cb-ptable-band') as HTMLElement | null
  /** Where band `k`'s top falls on this surface, in the px the wash is placed in. */
  const bandTop = (k: number, rowCount = 5) =>
    `${(k / rowCount) * Number.parseFloat(surface!.style.height)}px`
  return { ...view, surface, names, rows, band, bandTop }
}

describe('ProjectedTable', () => {
  it("sits at the rendered rect's origin, so it rides the picture and not the frame", () => {
    const { surface } = draw()
    expect(surface!.style.left).toBe('12px')
    expect(surface!.style.top).toBe('8px')
  })

  it('fills exactly the bands the author asked for, headings included', () => {
    const { container } = draw()
    expect(container.querySelectorAll('thead tr')).toHaveLength(1)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4)
    expect(screen.getByText('Name')).toBeTruthy()
  })

  it('spends no band on headings when the author turns them off', () => {
    const { container } = draw({ header: false })
    expect(container.querySelectorAll('thead')).toHaveLength(0)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5)
  })

  /*
   * There is no scroll container and nothing to draw a bar against: the rows past the
   * window are not in the document at all. That is also what makes the snap exact — a
   * clipped tall list would put row boundaries wherever the pixels fell.
   */
  it('leaves the rows past the window out of the document entirely', () => {
    const { container, names } = draw()
    expect(names()).toEqual(['name 0', 'name 1', 'name 2', 'name 3'])
    expect(container.textContent).not.toContain('name 9')
  })

  it('moves one whole row per notch of wheel', () => {
    const { surface, names } = draw()
    fireEvent.wheel(surface!, { deltaY: WHEEL_ROW_PX })
    expect(names()).toEqual(['name 1', 'name 2', 'name 3', 'name 4'])
    fireEvent.wheel(surface!, { deltaY: -WHEEL_ROW_PX })
    expect(names()).toEqual(['name 0', 'name 1', 'name 2', 'name 3'])
  })

  it('does not move on travel worth less than a row', () => {
    const { surface, names } = draw()
    fireEvent.wheel(surface!, { deltaY: WHEEL_ROW_PX / 4 })
    expect(names()).toEqual(['name 0', 'name 1', 'name 2', 'name 3'])
  })

  // The snap, stated as the thing a reader would see break: the same number of bands is
  // filled at every scroll position, so a row is drawn on the same drawn line throughout.
  it('keeps the band count fixed all the way to the end of the data', () => {
    const { surface, container } = draw()
    for (let i = 0; i < 12; i++) {
      fireEvent.wheel(surface!, { deltaY: WHEEL_ROW_PX })
      expect(container.querySelectorAll('tbody tr')).toHaveLength(4)
    }
  })

  it('stops at the last row rather than scrolling into blank bands', () => {
    const { surface, names } = draw()
    for (let i = 0; i < 20; i++) fireEvent.wheel(surface!, { deltaY: WHEEL_ROW_PX })
    expect(names()).toEqual(['name 6', 'name 7', 'name 8', 'name 9'])
  })

  it('ignores the wheel when every row already fits', () => {
    const { surface, names } = draw({ data: [['solo', '5550']] })
    fireEvent.wheel(surface!, { deltaY: WHEEL_ROW_PX * 3 })
    expect(names()[0]).toBe('solo')
  })

  it('shows nothing of the editor to a reader', () => {
    const { container, surface } = draw()
    expect(surface!.className).not.toContain('cb-ptable-editing')
    expect(container.querySelector('.cb-ed-quad')).toBeNull()
  })

  it('draws the outline and the band guides in the editor, and keeps out of the pointer', () => {
    const { surface } = draw({}, true)
    expect(surface!.className).toContain('cb-ptable-editing')
    expect(surface!.style.pointerEvents).toBe('none')
  })

  // The editor's own drag targets sit over this panel. A table that took the wheel there
  // would scroll rows while the author was trying to move the picture.
  it('does not take the wheel while the editor is open', () => {
    const { surface, names } = draw({}, true)
    fireEvent.wheel(surface!, { deltaY: WHEEL_ROW_PX })
    expect(names()).toEqual(['name 0', 'name 1', 'name 2', 'name 3'])
  })

  it('sizes the bands from the row count, not from the cell contents', () => {
    const { surface } = draw({ rows: 10 })
    const height = Number.parseFloat(surface!.style.height)
    expect(surface!.style.getPropertyValue('--cb-ptable-row')).toBe(`${height / 10}px`)
  })

  it('lands the surface on the quad with a projective transform', () => {
    const { surface } = draw()
    expect(surface!.style.transform.startsWith('matrix3d(')).toBe(true)
    expect(surface!.style.color).toBeTruthy()
  })

  /*
   * The band is the unit of everything inside a cell, and these two tests are one bug told
   * twice.
   *
   * The status used to be artwork given `2.2em` of a font that is itself a fraction of the
   * band, so at the shipped `fontScale` of 0.5 it stood 1.1 bands tall. A table row is a
   * *minimum* height in CSS: the row did not clip, it grew — every body row by 16%, while
   * the heading row, the one row with no artwork in it, stayed exactly one band. That is
   * what the notepad showed. The header was out of step with the body, each row sat lower
   * on its ruled line than the one above it until the lettering was struck through, and the
   * twenty-two rows ran 72 px past the foot of the pad. The artwork is gone — a status is a
   * word now — but the rule it broke is the one anything put in a cell has to keep.
   */
  it('sizes the gap from the band, not from the lettering', () => {
    const { surface } = draw({ rows: 10 })
    const rowH = Number.parseFloat(surface!.style.height) / 10
    const px = (name: string) => Number.parseFloat(surface!.style.getPropertyValue(name))
    expect(px('--cb-ptable-row')).toBeCloseTo(rowH, 6)
    expect(px('--cb-ptable-sit')).toBeCloseTo(rowH * BAND_SIT, 6)
  })

  // The other half of that, and the half no render can check: jsdom applies no CSS, so the
  // stylesheet is read as source. An `em` back in this rule is the bug back.
  it('spends the band variables in the stylesheet rather than ems', () => {
    const rules = cssRules(SKIN_CSS['src/skins/comic-book/table.css'])
    const cell = rules.find(r => r.selector === '.cb-ptable-cell')!.body
    expect(cell).toContain('var(--cb-ptable-sit)')
    expect(cell).not.toContain('em)')
  })

  /*
   * The backstop for the same failure: the rows live in a clip the size of the surface, so
   * a cell that outgrew its band again would be cut off at the edge of the notepad instead
   * of running the table down the page. `hidden`, never `auto` — there is nothing to
   * scroll, and a bar over a photograph would give the projection away.
   */
  it('holds the rows in a clip the size of the surface', () => {
    const { container } = draw()
    const clip = container.querySelector('.cb-ptable-clip')
    expect(clip).not.toBeNull()
    expect(clip!.querySelector('table.cb-ptable')).not.toBeNull()
    const body = cssRules(SKIN_CSS['src/skins/comic-book/table.css'])
      .find(r => r.selector === '.cb-ptable-clip')!.body
    expect(body).toContain('overflow: hidden')
  })

  // A cell is lettering and nothing else. The status column used to special-case a value
  // that looked like an image path and draw an `<img>` for it, which is what shrank the
  // status to an unreadable smudge at the size a projected band actually renders; a cell
  // that renders anything but its text again would fail here.
  it('letters every cell as text, drawing no image for any value', () => {
    const { container } = draw({
      columns: [{ label: 'Status', width: 1, align: 'center' }],
      data: [['In progress'], ['/comic-book/call-ended.webp']],
      header: false,
      rows: 2,
    })
    expect(container.querySelector('img')).toBeNull()
    const cells = [...container.querySelectorAll('.cb-ptable-cell')].map(c => c.textContent)
    expect(cells).toEqual(['In progress', '/comic-book/call-ended.webp'])
  })

  // A quad the author has collapsed while dragging has no matrix; drawing nothing beats
  // letting CSS drop a NaN transform and leave an unplaced table over the picture.
  it('draws nothing at all for a surface that has no geometry', () => {
    const point: Quad = [[50, 50], [50, 50], [50, 50], [50, 50]]
    const { container } = draw({ quad: point })
    expect(container.innerHTML).toBe('')
  })

  it('gives the keyboard the same whole-row step the wheel has', () => {
    const { names } = draw()
    fireEvent.click(screen.getByRole('button', { name: 'Scroll table down' }))
    expect(names()).toEqual(['name 1', 'name 2', 'name 3', 'name 4'])
    fireEvent.click(screen.getByRole('button', { name: 'Scroll table up' }))
    expect(names()).toEqual(['name 0', 'name 1', 'name 2', 'name 3'])
  })

  it('announces where in the data the visible rows are', () => {
    draw()
    expect(screen.getByText('Rows 1–4 of 10')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Scroll table down' }))
    expect(screen.getByText('Rows 2–5 of 10')).toBeTruthy()
  })

  it('offers no scroll controls when there is nothing to scroll', () => {
    draw({ data: [['solo', '5550']] })
    expect(screen.queryByRole('button', { name: 'Scroll table down' })).toBeNull()
  })
})

/*
 * The band washed behind the row under the pointer: **one flat, semi-transparent wash of
 * the authored ink, and nothing else.**
 *
 * Deliberately not the projected number pad's glow, which is the shape this started as.
 * The pad's glyphs are painted `transparent` outside the editor, so its light is the only
 * thing saying a key is there and has to breathe, flare and throw a halo to be seen. A row
 * is already written on the page. Everything that made the pad's light carry works against
 * it here — a halo blurs across the ruled lines either side, and a wash bright enough to
 * glow is one the row's own blue lettering stops reading through — so this asserts the
 * absence of all three as firmly as it asserts the wash.
 *
 * The band is placed in `--cb-ptable-row` units rather than pixels for the same reason the
 * scroll is an index: a row is welded to a line drawn in the picture by being a whole band,
 * and the highlight has to be welded to the same one.
 */
describe('ProjectedTable row highlight', () => {
  it('washes nothing until the pointer is on a row', () => {
    expect(draw().band()).toBeNull()
  })

  it('washes the band the hovered row is lettered in', () => {
    const view = draw()
    fireEvent.pointerEnter(view.rows()[2])
    // Band 3: the heading takes band 0, so the third body row is the fourth band down.
    expect(view.band()!.style.top).toBe(view.bandTop(3))
    expect(view.band()!.style.height).toBe(view.bandTop(1))
  })

  it('counts the heading out of the bands when the author turns it off', () => {
    const view = draw({ header: false })
    fireEvent.pointerEnter(view.rows()[2])
    expect(view.band()!.style.top).toBe(view.bandTop(2))
  })

  it('clears the band when the pointer leaves', () => {
    const view = draw()
    fireEvent.pointerEnter(view.rows()[1])
    fireEvent.pointerLeave(view.rows()[1])
    expect(view.band()).toBeNull()
  })

  it('moves the band rather than washing two at once', () => {
    const view = draw()
    fireEvent.pointerEnter(view.rows()[0])
    fireEvent.pointerLeave(view.rows()[0])
    fireEvent.pointerEnter(view.rows()[3])
    expect(view.container.querySelectorAll('.cb-ptable-band')).toHaveLength(1)
    expect(view.band()!.style.top).toBe(view.bandTop(4))
  })

  /*
   * `visibleRows` pads its window with empty rows so the surface covers the same bands
   * whatever the data does. Those are ruled lines with nothing written on them: lighting
   * one would say a record is there when there is not, and a whole notepad of blank bands
   * washing under the pointer is the projection giving itself away.
   */
  it('leaves the blank bands below the last record unwashed and unpointed', () => {
    const view = draw({ data: [['only', '5550']] })
    expect(view.rows()).toHaveLength(4)
    expect(view.rows().filter(r => r.className.includes('cb-ptable-row'))).toHaveLength(1)

    fireEvent.pointerEnter(view.rows()[2])
    expect(view.band()).toBeNull()
  })

  it('keeps the band under the pointer as the rows scroll beneath it', () => {
    const view = draw()
    fireEvent.pointerEnter(view.rows()[1])
    fireEvent.wheel(view.surface!, { deltaY: WHEEL_ROW_PX })
    // The band is the thing the pointer is on, and a band does not move: the rows slide
    // through it. The band stays where the pointer is, over whatever is written there now.
    expect(view.band()!.style.top).toBe(view.bandTop(2))
    expect(view.rows()[1].textContent).toContain('name 2')
  })

  /*
   * A fitted surface: the bands are where the drawing's lines are, not equal fifths. The
   * row's own height and the wash behind it are read off the same list, so both land on
   * the drawn line — the claim is checked on both, from the one `lines` array.
   */
  it('gives each row, and the wash behind it, the height of its own drawn band', () => {
    const lines = [0, 0.18, 0.4, 0.6, 0.79, 1]
    const view = draw({ lines })
    const height = Number.parseFloat(view.surface!.style.height)
    const bandPx = (k: number) => (lines[k + 1]! - lines[k]!) * height

    const head = view.container.querySelector('thead tr') as HTMLElement
    expect(Number.parseFloat(head.style.getPropertyValue('--cb-ptable-row'))).toBeCloseTo(bandPx(0), 6)
    view.rows().forEach((el, i) => {
      const tr = el as HTMLElement
      expect(Number.parseFloat(tr.style.getPropertyValue('--cb-ptable-row')), `row ${i}`)
        .toBeCloseTo(bandPx(i + 1), 6)
      expect(Number.parseFloat(tr.style.getPropertyValue('--cb-ptable-sit')), `row ${i} sit`)
        .toBeCloseTo(bandPx(i + 1) * BAND_SIT, 6)
    })

    fireEvent.pointerEnter(view.rows()[2])
    expect(Number.parseFloat(view.band()!.style.top)).toBeCloseTo(lines[3]! * height, 6)
    expect(Number.parseFloat(view.band()!.style.height)).toBeCloseTo(bandPx(3), 6)
  })

  it('ignores a fitted ruling that was measured for a different row count', () => {
    const view = draw({ lines: [0, 0.5, 1] })
    const height = Number.parseFloat(view.surface!.style.height)
    view.rows().forEach(el => {
      const tr = el as HTMLElement
      expect(Number.parseFloat(tr.style.getPropertyValue('--cb-ptable-row'))).toBeCloseTo(height / 5, 6)
    })
  })

  /*
   * Derived from the data on every render rather than repaired in an effect, because the
   * data moves on its own: a live surface polls its feed, and an author's paste can take
   * rows away. An offset is pulled back the same way — a band washed for one frame over a
   * record that is no longer there is the same bug one layer up.
   */
  it('clears the band when the record under it goes away', () => {
    const view = draw()
    fireEvent.pointerEnter(view.rows()[3])
    expect(view.band()).not.toBeNull()

    view.rerender(<ProjectedTable table={table({ data: [['last', '5559']] })} base={BASE} editing={false} />)
    expect(view.band()).toBeNull()
  })

  // The editor's own drag targets sit over this panel and the surface takes no pointer
  // input there, so a band washing under an author's drag would be a highlight on nothing.
  it('washes no band while the editor is open', () => {
    const view = draw({}, true)
    expect(view.rows().filter(r => r.className.includes('cb-ptable-row'))).toHaveLength(0)
    fireEvent.pointerEnter(view.rows()[1])
    expect(view.band()).toBeNull()
  })

  /*
   * The wash goes behind the lettering, not over it. Both are positioned — the band
   * absolutely, the table relatively — so the pair paint in document order, which is the
   * same mechanism that decides which picture is in front of which. A `z-index` on either
   * would take them out of that order, and `imageDepthRender.test.tsx` has the half of
   * that which matters to a reader.
   */
  it('draws the band behind the lettering, by document order and no z-index', () => {
    const view = draw()
    fireEvent.pointerEnter(view.rows()[1])
    const table = view.container.querySelector('table.cb-ptable')!
    expect(view.band()!.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()

    const rules = cssRules(SKIN_CSS['src/skins/comic-book/table.css'])
    const positioned = rules.filter(r => /\.cb-ptable-band|\.cb-ptable\b/.test(r.selector))
    expect(positioned.length).toBeGreaterThan(1)
    expect(positioned.filter(r => /z-index/.test(r.body))).toEqual([])

    // Document order decides it only while *both* are positioned. An unpositioned table
    // is painted in an earlier phase than the absolutely positioned band, so dropping
    // this one line puts the wash over the lettering however the DOM is ordered.
    expect(rules.find(r => r.selector === '.cb-ptable')!.body).toMatch(/position:\s*relative/)
    expect(rules.find(r => r.selector === '.cb-ptable-band')!.body)
      .toMatch(/position:\s*absolute/)
  })

  it('washes the band in the ink the author gave the surface', () => {
    const { surface } = draw({ ink: '#1b3a8f' })
    expect(surface!.style.getPropertyValue('--cb-ptable-ink')).toBe('#1b3a8f')
  })

  /*
   * The three things the highlight is *not*, asserted because each one was in this file a
   * revision ago and each is a step back toward the pad's key rather than a row's wash.
   * jsdom applies no CSS, so the stylesheet is read as source.
   */
  it('washes the band flat: no halo, no pulse, no pressed state', () => {
    const css = SKIN_CSS['src/skins/comic-book/table.css']
    const band = cssRules(css).filter(r => /\.cb-ptable-band/.test(r.selector))
    expect(band).toHaveLength(1)

    // A `box-shadow` is the fuzz at the band's edges; it would blur the wash across the
    // ruled lines above and below the row it is meant to pick out.
    expect(band[0].body).not.toMatch(/box-shadow/)
    // An `animation` is the breathing, and there are no keyframes here to breathe through.
    expect(band[0].body).not.toMatch(/animation/)
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/@keyframes/)
    // And nothing anywhere answers a press: the rows do not act on a click, so a pressed
    // state would be feedback for something that never happens.
    expect(css).not.toMatch(/is-pressed|:active/)
  })

  it('washes it weakly enough to read the row’s own lettering through', () => {
    const band = cssRules(SKIN_CSS['src/skins/comic-book/table.css'])
      .find(r => /\.cb-ptable-band/.test(r.selector))!
    const mix = /color-mix\(\s*in srgb\s*,\s*var\(\s*--cb-ptable-ink[^)]*\)\s*(\d+(?:\.\d+)?)%/
    const pct = Number(band.body.match(mix)![1])

    // Enough to pick the row out against a photographed page, and not so much that the
    // dark blue lettering on it stops reading — the failure that took the pad's levels
    // (34% to 62%, and 96% on the press) off this surface.
    expect(pct).toBeGreaterThanOrEqual(15)
    expect(pct).toBeLessThanOrEqual(40)
  })
})
