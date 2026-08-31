import { describe, expect, it } from 'vitest'

import type { TableSource } from '../../lib/liveTables'
import { layoutViolations, violationLines } from '../../skins/comic-book/editor/configParity'
import type { BubbleTransform, ImgTransform, Panel, TableColumn } from '../../skins/comic-book/editor/types'

// A finished caption: it says something, it points at a speaker, and it answers both a
// hover and a press. Every bubble case below is this one with a field taken away.
const caption = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  panel: 1,
  top: -35,
  right: -12,
  width: 55,
  rotate: -5,
  spill: true,
  type: 'soft',
  tail: 'down-left',
  content: 'text',
  text: 'Hello',
  linkTo: null,
  hoverType: 'cloud',
  clickType: 'lightning',
  hoverBold: false,
  chain: '',
  ...over,
})

const picture = (over: Partial<ImgTransform> = {}): ImgTransform => ({
  panel: 0,
  src: '/comic-book/logo.webp',
  alt: 'Carameli',
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  anchor: 'center bottom',
  spill: false,
  ...over,
})

// Only the length is read, so the cases below name panels 0–11 the way the shipped
// layout does without restating any of it.
const panels: Panel[] = Array.from({ length: 12 }, (_, i) => ({
  label: `Panel ${i}`,
  isLogo: i === 0,
  page: 'classic',
}))

const of = (bubbles: BubbleTransform[], images: ImgTransform[] = []) =>
  violationLines(layoutViolations({ images, bubbles, panels }))

describe('layoutViolations — a finished layout', () => {
  it('finds nothing wrong with a caption that is done', () => {
    expect(layoutViolations({ images: [picture()], bubbles: [caption()], panels })).toEqual([])
  })

  // A panel split in two appends one to the working copy, so the count that decides
  // "panel 12 does not exist" has to be this layout's own, not the shipped constant's.
  it('accepts a balloon on a panel the layout has and the shipped file does not', () => {
    const grown = [...panels, { label: 'Panel 12', isLogo: false, page: 'classic' as const }]
    expect(layoutViolations({ images: [], bubbles: [caption({ panel: 12 })], panels: grown })).toEqual([])
    expect(of([caption({ panel: 12 })])).toEqual([
      'bubble 0 (“Hello”) sits on panel 12, which is not one of the 12 panels',
    ])
  })
})

describe('layoutViolations — the state the editor drops on the page', () => {
  // Verbatim from the balloons `+ Bubble` left behind in three separate worktrees: a
  // placeholder caption with no tail and neither morph target chosen. This is the shape
  // the whole module exists to name, so it is asserted as the literal it was found as
  // rather than as a call to the factory above.
  const placeholder: BubbleTransform = {
    panel: 11, top: -20, right: 28, width: 27, rotate: -5, spill: true, type: 'soft',
    tail: 'none', content: 'text', text: 'New bubble', linkTo: null,
    hoverType: null, clickType: null, hoverBold: false, chain: '',
  }

  it('names the tail, the hover and the click, and nothing else', () => {
    expect(of([placeholder])).toEqual([
      'bubble 0 (“New bubble”) has no tail, so nothing on the page says who is speaking',
      'bubble 0 (“New bubble”) has no hover shape, so it does not answer the pointer',
      'bubble 0 (“New bubble”) has no click shape, so it does not answer a press',
    ])
  })

  it('reports each unfinished balloon separately, so the count is the work left', () => {
    expect(of([placeholder, placeholder, caption()])).toHaveLength(6)
  })
})

describe('layoutViolations — captions', () => {
  it('wants a tail on the first end of a linked pair but not the second', () => {
    const pair = [
      caption({ tail: 'none', linkTo: 1 }),
      caption({ tail: 'none' }),
    ]
    expect(of(pair)).toEqual([
      'bubble 0 (“Hello”) has no tail, so nothing on the page says who is speaking',
    ])
  })

  it('wants a hover and a click shape distinct from the resting one', () => {
    expect(of([caption({ hoverType: 'soft', clickType: 'soft' })])).toEqual([
      'bubble 0 (“Hello”) morphs to its own resting shape on hover, which reads as nothing happening',
      'bubble 0 (“Hello”) morphs to its own resting shape on click, which reads as nothing happening',
    ])
  })

  it('wants something in a caption', () => {
    expect(of([caption({ text: '' })])).toEqual(['bubble 0 is a caption with nothing to say'])
  })
})

describe('layoutViolations — what is not a caption', () => {
  // A field is placed where the art puts it and points at nothing; a chained balloon is a
  // template the live thread stamps. Neither takes a tail or a morph target, so neither
  // may be reported for going without one.
  it('exempts a field from the tail and the morph targets', () => {
    const field = caption({ content: 'phone', tail: 'none', hoverType: null, clickType: null })
    expect(of([field])).toEqual([])
  })

  it('exempts a balloon in a chain from the same three', () => {
    const member = caption({ chain: 'thread-1', tail: 'none', hoverType: null, clickType: null })
    expect(of([member])).toEqual([])
  })

  it('still holds a field to the rules that are about drawing at all', () => {
    expect(of([caption({ content: 'wheel', width: 0, panel: 99 })])).toEqual([
      'bubble 0 (“Hello”) sits on panel 99, which is not one of the 12 panels',
      'bubble 0 (“Hello”) has no width, so it draws nothing',
    ])
  })
})

describe('layoutViolations — links the renderer would drop', () => {
  it('catches a self link', () => {
    expect(of([caption({ linkTo: 0 })])).toEqual(['bubble 0 (“Hello”) is linked to itself'])
  })

  it('catches a link past the end of the array', () => {
    expect(of([caption({ linkTo: 7 })])).toEqual([
      'bubble 0 (“Hello”) is linked to bubble 7, which does not exist',
    ])
  })

  // The tube never appears and nothing says why, which is the reason this is worth a
  // violation rather than being left to the renderer to swallow.
  it('catches a link across panels', () => {
    expect(of([caption({ linkTo: 1 }), caption({ panel: 2 })])).toEqual([
      'bubble 0 (“Hello”) is linked across panels to bubble 1, and no tube is drawn for that',
    ])
  })
})

describe('layoutViolations — pictures', () => {
  it('catches a frame with no extent', () => {
    expect(of([], [picture({ width: 0 })])).toEqual([
      'picture 0 (/comic-book/logo.webp) has a frame with no extent, so none of it is on screen',
    ])
  })

  it('catches a scale that draws nothing', () => {
    expect(of([], [picture({ scale: 0 })])).toEqual([
      'picture 0 (/comic-book/logo.webp) is scaled to 0, which draws nothing',
    ])
  })

  it('catches art served from outside the skin’s own directory', () => {
    expect(of([], [picture({ src: '/icons/icon-192.png' })])).toEqual([
      'picture 0 (/icons/icon-192.png) is not served from /comic-book/',
    ])
  })

  it('catches a picture carrying two projected surfaces', () => {
    const both = picture({
      table: { quad: [[0, 0], [1, 0], [1, 1], [0, 1]], rows: 4, header: true, fontScale: 0.5, ink: '#000', columns: [], data: [] },
      numberPad: { quad: [[0, 0], [1, 0], [1, 1], [0, 1]], fontScale: 0.5, ink: '#000' },
    })
    expect(of([], [both])).toEqual([
      'picture 0 (/comic-book/logo.webp) carries both a table and a number pad; a picture has one projected surface',
    ])
  })

  // The regression this pair exists for: a Save from an editor tab opened before the
  // call-records feed changed shape wrote the old five-column list back over the new
  // four, and the page then drew every value one heading to the left with the last
  // column empty. Nothing was red — the feed's mapper and its tests were untouched, and
  // the headings live in a file the editor rewrites wholesale.
  const liveTable = (columns: TableColumn[], source?: TableSource) =>
    picture({
      table: {
        quad: [[0, 0], [1, 0], [1, 1], [0, 1]], rows: 4, header: true, fontScale: 0.5,
        ink: '#000', columns, data: [], source,
      },
    })

  const CALL_COLUMNS: TableColumn[] = [
    { label: 'Number', width: 2, align: 'left' },
    { label: 'Start time', width: 1.4, align: 'left' },
    { label: 'Duration', width: 1, align: 'left' },
    { label: 'Status', width: 0.7, align: 'center' },
  ]

  it('catches a live surface holding more headings than its feed has values', () => {
    const stale: TableColumn[] = [
      { label: 'Time', width: 1, align: 'left' },
      { label: 'Dir', width: 0.7, align: 'left' },
      { label: 'From', width: 1.8, align: 'left' },
      { label: 'To', width: 1.8, align: 'left' },
      { label: 'Status', width: 1.3, align: 'left' },
    ]
    expect(of([], [liveTable(stale, 'calls')])).toEqual([
      'picture 0 (/comic-book/logo.webp) is wired to call records but holds 5 columns for '
      + "that feed's 4 values, so its headings do not name its cells",
    ])
  })

  it('catches a live surface holding fewer', () => {
    expect(of([], [liveTable(CALL_COLUMNS.slice(0, 3), 'calls')])).toEqual([
      'picture 0 (/comic-book/logo.webp) is wired to call records but holds 3 columns for '
      + "that feed's 4 values, so its headings do not name its cells",
    ])
  })

  // Wording and proportion are the author's: a heading renamed to suit the art, or a
  // column widened to sit on the ruling in the photograph, is the editor working.
  it('leaves an author’s headings and widths alone at the feed’s own count', () => {
    const reworded = CALL_COLUMNS.map((c, i) => (i === 0 ? { ...c, label: 'Caller', width: 3 } : c))
    expect(of([], [liveTable(reworded, 'calls')])).toEqual([])
  })

  // An authored surface has no feed to disagree with, so any number of columns is right.
  it('says nothing about a surface with no feed', () => {
    expect(of([], [liveTable(CALL_COLUMNS.slice(0, 2))])).toEqual([])
  })

  it('reports pictures before bubbles, so the list reads down the page', () => {
    expect(of([caption({ width: 0 })], [picture({ scale: 0 })])).toEqual([
      'picture 0 (/comic-book/logo.webp) is scaled to 0, which draws nothing',
      'bubble 0 (“Hello”) has no width, so it draws nothing',
    ])
  })
})
