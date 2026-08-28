/**
 * The guardrail for one invariant: **a picture in the comic-book skin never renders a
 * border, and its window is never reshaped into a panel.**
 *
 * It has been broken twice, both times by a change that read as an improvement. The ink
 * layer stroked a 5 px black polygon around any picture whose frame was not the whole
 * panel ("an inset picture reads as a panel-within-a-panel"), and the clip scaled the
 * panel's polygon *into* the picture's frame, giving that picture the grid's slanted
 * gutters. On screen the two together put a black, differently-shaped border over the
 * editor's selection outline — which traces the artwork's real rect — so the renderer
 * and the editor disagreed about where the picture was.
 *
 * Three halves, because the bug has three routes back in and no single test covers them:
 *
 * 1. **The DOM** — the ink layer and the panel are rendered *together*, because that is
 *    the pairing the bug lived in. However many pictures the panel draws, the count of
 *    stroked outlines is the count of panels.
 * 2. **The shape** — the inset picture's clip is the panel polygon *translated*, edge
 *    for edge. A scaled one is a small panel, and that is what this measures.
 * 3. **The stylesheet** — jsdom applies no CSS, so a `border` added to `.cb-img-clip`
 *    would pass (1) and (2) untouched. That route is closed by reading the CSS.
 *
 * A fourth lives in `PanelInk.test.tsx`, and it is the one that actually catches the
 * historical bug: `PanelInkProps` is asserted at compile time to be `polys` and nothing
 * else. (1) cannot do that job on its own — a re-added image loop would read a prop this
 * file does not pass, draw nothing, and leave every count here green.
 */

import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import ComicPanel from '../../skins/comic-book/ComicPanel'
import PanelInk from '../../skins/comic-book/PanelInk'
import type { ImgTransform } from '../../skins/comic-book/editor/types'
import type { Panel } from '../../skins/comic-book/panels'
import { SKIN_CSS, cssRules } from './skinCss'
import { idleSms } from './smsStub'

// A slanted quad, like the real panel polygons — the gutters are not square, which is
// what makes a scaled copy of this shape distinguishable from a translated one.
const VP: [number, number][] = [[0, 0], [400, 20], [380, 300], [20, 280]]
const BOUNDS = { x: 0, y: 0, w: 400, h: 300 }

const PANEL: Panel = { label: 'Switchboard', isLogo: false, page: 'classic' }

/** A picture; `over` overrides the frame, which is the half that used to grow ink. */
function img(over: Partial<ImgTransform> = {}): ImgTransform {
  return {
    panel: 0,
    src: '/comic-book/switchboard.webp',
    alt: 'Switchboard',
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    anchor: 'center center',
    spill: false,
    ...over,
  }
}

/**
 * One panel carrying `images`, **plus the ink layer that draws over it** — no bubbles,
 * so every stroked vector in the result is either the panel's outline or ink that has
 * been attached to a picture. Rendering the two together is the point: the ink is a
 * viewport-level SVG, and the bug this file guards was a loop inside it.
 */
function renderPanel(images: ImgTransform[]): HTMLElement {
  const { container } = render(
    <MemoryRouter initialEntries={['/']}>
      <PanelInk polys={[{ vp: VP, bounds: BOUNDS }]} />
      <ComicPanel
        index={0}
        info={PANEL}
        poly={{ vp: VP, bounds: BOUNDS }}
        images={images}
        bubbles={[]}
        chains={[]}
        sms={idleSms()}
        natSizes={{}}
        editorActive={false}
        hovered={false}
        isRevealed={() => false}
        isBubbleVisible={() => false}
        dotRef={() => undefined}
        onSettled={() => undefined}
        onNatSize={() => undefined}
      />
    </MemoryRouter>,
  )
  return container
}

/** The `polygon(x y, …)` points of an element's inline clip-path, in px. */
function clipPoints(el: HTMLElement): [number, number][] {
  const clip = el.style.clipPath
  expect(clip).toMatch(/^polygon\(/)
  return [...clip.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map(
    m => [Number(m[1]), Number(m[2])] as [number, number],
  )
}

/** Each edge of a closed ring as a delta — the ring's shape, independent of where it is. */
function edges(pts: [number, number][]): [number, number][] {
  return pts.map(([x, y], i) => {
    const [nx, ny] = pts[(i + 1) % pts.length]
    return [nx - x, ny - y] as [number, number]
  })
}

describe('a picture renders no border', () => {
  // One panel goes in, so exactly one outline comes out — whatever the pictures are
  // doing. The inset frame is the case that used to grow a second polygon, and the pair
  // is the case that used to grow two.
  it.each([
    ['a full-panel frame', [img()]],
    ['an inset frame', [img({ left: 20, top: 20, width: 45, height: 45 })]],
    ['both at once', [img(), img({ left: 55, top: 10, width: 40, height: 40 })]],
  ] as const)('strokes one outline — the panel\'s — with %s', (_label, images) => {
    const container = renderPanel([...images])
    const outlines = container.querySelectorAll('polygon')

    expect(outlines).toHaveLength(1)
    expect(outlines[0].getAttribute('points')).toBe(
      VP.map(([x, y]) => `${x},${y}`).join(' '),
    )
    // Nothing else vector-shaped is stroked around the pictures either.
    for (const el of container.querySelectorAll('path, rect, circle, line')) {
      expect(el.getAttribute('stroke') ?? 'none').toBe('none')
    }
    expect(container.querySelectorAll('.cb-panel-img')).toHaveLength(images.length)
  })

  // The other way to draw a border on a picture is to style one, so the inline styles
  // the renderer writes are checked too. `outline` is included deliberately: it is the
  // property most likely to be reached for as "just a debug outline" and left behind.
  it('sets no border, outline or shadow on the wrapper or the picture', () => {
    const container = renderPanel([img({ left: 20, top: 20, width: 45, height: 45 })])
    for (const el of container.querySelectorAll<HTMLElement>('.cb-img-clip, .cb-panel-img')) {
      for (const prop of ['border', 'borderWidth', 'outline', 'outlineWidth', 'boxShadow'] as const) {
        expect(el.style[prop]).toBe('')
      }
    }
  })
})

describe("a picture's window is the panel's, translated", () => {
  // The shipped case: the frame is the panel box, so the clip is the panel polygon at
  // the panel's own origin. This is why the page looked unchanged through both bugs and
  // both fixes — and why it can only ever be half a test.
  it('is the panel polygon itself at a full-panel frame', () => {
    const container = renderPanel([img()])
    const wrapper = container.querySelector<HTMLElement>('.cb-img-clip')!
    expect(clipPoints(wrapper)).toEqual(VP)
  })

  // The half that matters. A translated polygon has the panel's edges exactly; a scaled
  // one has the same *shape* at a smaller size, which is a small panel — the thing a
  // picture must never become. Comparing edge deltas is what tells those two apart.
  it('keeps the panel\'s edges edge-for-edge when the frame is inset', () => {
    const container = renderPanel([img({ left: 20, top: 20, width: 45, height: 45 })])
    const wrapper = container.querySelector<HTMLElement>('.cb-img-clip')!
    const pts = clipPoints(wrapper)

    expect(edges(pts)).toEqual(edges(VP))
    // …and it really is offset, so this is not passing by the frame having been ignored.
    expect(pts[0]).not.toEqual(VP[0])
  })

  // With the clip unscaled, a frame well inside the panel is not cut by the panel at
  // all: every clip vertex falls outside the wrapper, so only the frame box bites and
  // the picture keeps its own square corners. This is "a picture is a rectangle" stated
  // as an assertion.
  it('leaves a picture clear of the panel edges with square corners', () => {
    const container = renderPanel([img({ left: 30, top: 30, width: 30, height: 30 })])
    const wrapper = container.querySelector<HTMLElement>('.cb-img-clip')!
    const w = (30 / 100) * BOUNDS.w
    const h = (30 / 100) * BOUNDS.h

    for (const [x, y] of clipPoints(wrapper)) {
      expect(x < 0 || x > w || y < 0 || y > h).toBe(true)
    }
  })
})

describe('the stylesheet gives a picture no border either', () => {
  // Every stylesheet the skin ships, read as source — from disk, via `skinCss.ts`. This
  // block used to glob them with `import.meta.glob(…, { query: '?raw' })`, which Vitest's
  // default `css: false` stubs to the **empty string**: the file list was right, every
  // rule assertion below ran against no content, and the whole describe had been green on
  // nothing since it was written.
  const CSS_FILES = Object.keys(SKIN_CSS).sort()

  /** A declaration that paints an edge — `none`/`0` is the absence of one, so it passes. */
  function paintsAnEdge(body: string): string[] {
    return [...body.matchAll(/(border[a-z-]*|outline[a-z-]*|box-shadow)\s*:\s*([^;]+)/g)]
      .filter(m => !/^(none|0|unset|initial)$/.test(m[2].trim()))
      .map(m => `${m[1]}: ${m[2].trim()}`)
  }

  // Asserted non-empty first, contents and all: an `it.each([])` is zero tests and a green
  // run, and a stylesheet that resolved to nothing is the same silence one level down.
  it('finds the skin\'s stylesheets, with their contents', () => {
    expect(CSS_FILES.length).toBeGreaterThan(5)
    expect(CSS_FILES.filter(f => SKIN_CSS[f].trim() === '')).toEqual([])
  })

  it.each(CSS_FILES)('%s styles no edge onto a picture', file => {
    const offenders = cssRules(SKIN_CSS[file])
      .filter(r => /\.cb-img-clip|\.cb-panel-img/.test(r.selector))
      .flatMap(r => paintsAnEdge(r.body).map(d => `${r.selector} { ${d} }`))

    // A picture's edges are the artwork's own. Anything drawn around them is the skin
    // claiming the picture is a panel, which is the bug this file exists to prevent.
    expect(offenders).toEqual([])
  })

  // The parser is asserted against a rule that should fail, so a green run above means
  // "no such rule" rather than "the regex matched nothing".
  it('would catch a border added to the clip wrapper', () => {
    const offenders = cssRules('.cb-img-clip { border: 5px solid #111111; }')
      .filter(r => /\.cb-img-clip/.test(r.selector))
      .flatMap(r => paintsAnEdge(r.body))

    expect(offenders).toEqual(['border: 5px solid #111111'])
    expect(paintsAnEdge('border: none;')).toEqual([])
  })
})
