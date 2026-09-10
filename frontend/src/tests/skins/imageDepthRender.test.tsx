import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import PanelImages from '../../skins/comic-book/PanelImages'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import ImageInspector from '../../skins/comic-book/editor/ImageInspector'
import { newTable } from '../../skins/comic-book/editor/tableValidate'
import type { ImgTransform } from '../../skins/comic-book/editor/types'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'

// Depth in the DOM, where it actually decides anything. `imageDepth.test.ts` pins the
// ordering function; these are the two ends of it — the page drawing pictures in that
// order, and the field an author sets it from.
//
// Document order is the assertion because that is the mechanism: two positioned siblings
// with no z-index paint in tree order, so "in front" and "later in the DOM" are the same
// statement. A test that read a z-index off the element would pass against a broken page.

const BOUNDS = { x: 0, y: 0, w: 400, h: 300 }
const VP: [number, number][] = [
  [0, 0],
  [400, 0],
  [400, 300],
  [0, 300],
]

function img(src: string, over: Partial<ImgTransform> = {}): ImgTransform {
  return {
    panel: 0,
    src,
    alt: '',
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    anchor: 'center center',
    spill: false,
    z: 0,
    ...over,
  }
}

function draw(images: ImgTransform[]) {
  const view = render(
    <PanelImages
      images={images}
      panel={0}
      bounds={BOUNDS}
      vp={VP}
      natSizes={{}}
      isRevealed={() => false}
      editing={false}
      onSettled={() => {}}
      onNatSize={() => {}}
    />,
  )
  return view.container
}

/** The `src` of each drawn picture, back to front. */
function drawnSources(container: HTMLElement): string[] {
  return [...container.querySelectorAll('img.cb-panel-img')].map(el => el.getAttribute('src') ?? '')
}

const NOTEPAD = '/comic-book/hand-notepad.webp'
const HAND = '/comic-book/rotary%20phone.webp'

describe('PanelImages depth', () => {
  it('draws the pictures back to front whatever order the config lists them in', () => {
    const container = draw([img(HAND, { z: 1 }), img(NOTEPAD, { z: 0 })])
    expect(drawnSources(container)).toEqual([NOTEPAD, HAND])
  })

  it('leaves pictures at the shipped default in config order', () => {
    const container = draw([img(HAND), img(NOTEPAD)])
    expect(drawnSources(container)).toEqual([HAND, NOTEPAD])
  })

  // The look this was added for: the table rides inside the notepad's own wrapper, so a
  // picture drawn in front of the notepad is drawn in front of its rows too — no part of
  // the projection has to know a hand exists.
  it('draws a picture in front of the table projected onto the one behind it', () => {
    const container = draw([
      img(NOTEPAD, { z: 0, table: newTable() }),
      img(HAND, { z: 1 }),
    ])
    const surface = container.querySelector('.cb-ptable-surface')
    const hand = container.querySelector(`img[src="${HAND}"]`)
    expect(surface).not.toBeNull()
    expect(hand).not.toBeNull()
    // Node.compareDocumentPosition: FOLLOWING means the hand comes after the rows, which
    // is what paints it over them.
    expect(surface!.compareDocumentPosition(hand!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
  })

  /*
   * The same statement about the *highlight* on a row rather than about the row itself, and
   * it needs saying separately because a highlight is the thing somebody reaches for a
   * z-index to fix. The band washed under the pointer rides inside the notepad's wrapper
   * like the rows do, so the hand at depth 1 passes over it; one z-index on the band — or
   * on the table in front of it — would lift the wash out of the paint order and tint the
   * hand with it.
   */
  it('draws a picture in front of the band washed behind the rows', () => {
    const container = draw([
      img(NOTEPAD, { z: 0, table: newTable() }),
      img(HAND, { z: 1 }),
    ])
    const row = container.querySelector('tbody tr.cb-ptable-row')
    expect(row).not.toBeNull()
    fireEvent.pointerEnter(row!)

    const band = container.querySelector('.cb-ptable-band')
    const hand = container.querySelector(`img[src="${HAND}"]`)
    expect(band).not.toBeNull()
    expect(band!.compareDocumentPosition(hand!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Document order only decides it while neither side has stepped out of it.
    for (const el of [band!, container.querySelector('table.cb-ptable')!]) {
      expect((el as HTMLElement).style.zIndex).toBe('')
    }
  })

  it('keeps a picture that belongs to another panel off this one', () => {
    const container = draw([img(HAND, { panel: 1, z: 9 }), img(NOTEPAD)])
    expect(drawnSources(container)).toEqual([NOTEPAD])
  })
})

describe('the depth field', () => {
  function inspector(image: ImgTransform) {
    const api = { setImg: vi.fn(), config: seedConfig() } as unknown as EditorModeApi
    render(<ImageInspector api={api} index={2} image={image} />)
    return api
  }

  it('shows the depth a picture carries and sets the one that is typed', () => {
    const api = inspector(img(NOTEPAD, { z: 1 }))
    const field = screen.getByLabelText('depth') as HTMLInputElement
    expect(field.value).toBe('1')

    fireEvent.change(field, { target: { value: '4' } })
    expect(api.setImg).toHaveBeenCalledWith(2, { z: 4 })
  })

  it('clamps a depth past the ends of the range instead of taking it', () => {
    const api = inspector(img(NOTEPAD))
    fireEvent.change(screen.getByLabelText('depth'), { target: { value: '400' } })
    expect(api.setImg).toHaveBeenCalledWith(2, { z: 9 })
  })

  // Emptying the field is a keystroke in the middle of retyping a number, not a request
  // to send the picture to the back of the panel.
  it('holds the current depth while the field is empty', () => {
    const api = inspector(img(NOTEPAD, { z: 3 }))
    fireEvent.change(screen.getByLabelText('depth'), { target: { value: '' } })
    expect(api.setImg).toHaveBeenCalledWith(2, { z: 3 })
  })
})
