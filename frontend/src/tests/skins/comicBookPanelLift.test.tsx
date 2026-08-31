/**
 * The guardrail for one invariant: **a panel's ink keeps its full width while the
 * pointer is on it.**
 *
 * The ink is a 5 px stroke centred on the panel polygon (PanelInk), so half of it falls
 * *inside* the panel — and a panel's Ben-Day canvas and its clipped pictures are clipped
 * to that same polygon. While the panel element itself carried the hover lift
 * (`.cb-panel-lift { z-index: 8 }`) it rose over the ink layer (z 3) and took that
 * clipped content with it, painting out the inner half of the stroke: the border read as
 * dropping to half width under the pointer, on the one panel the reader was looking at.
 *
 * The fix is that the lift belongs to the balloons, not to the panel — so this file
 * asserts the shape of the layering rather than the one rule that broke it:
 *
 * 1. **No panel-level layer outranks the ink.** Any rule that raises `.cb-panel`,
 *    `.cb-panel-lift` or `.cb-panel-reveal` above the outline SVG puts the panel's own
 *    clipped content over its own border, whatever it was trying to lift.
 * 2. **The lift still reaches the balloons** — `.cb-bubble-clip` traps them at z 1, below
 *    the ink, so a hovered panel must raise that wrapper above the ink and leave it below
 *    the tube layer, whose white fill welds the tubes to the outlines it paints over.
 * 3. **The class is on the panel and the wrapper is under it**, so the descendant
 *    selector in (2) has something to match. jsdom applies no CSS, which is why (1) and
 *    (2) read the stylesheets as source and this one reads the DOM.
 */

import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import ComicPanel from '../../skins/comic-book/ComicPanel'
import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'
import type { Panel } from '../../skins/comic-book/panels'
import { SKIN_CSS, cssRules } from './skinCss'
import { idleSms } from './smsStub'

const VP: [number, number][] = [[0, 0], [400, 20], [380, 300], [20, 280]]
const BOUNDS = { x: 0, y: 0, w: 400, h: 300 }
const PANEL: Panel = { label: 'Switchboard', isLogo: false, page: 'classic' }

/** A balloon that does not spill, so PanelBubbles wraps it in `.cb-bubble-clip`. */
const CLIPPED_BUBBLE: BubbleTransform = { ...NEW_BUBBLE, panel: 0, spill: false, text: 'HELLO' }

/** One `z-index` declaration, with the single selector it applies to. */
interface Layer {
  file: string
  /** One comma-separated part of the rule's selector list. */
  selector: string
  z: number
}

/** Every `z-index` the skin sets, one entry per selector in each rule's list. */
function layers(): Layer[] {
  const found: Layer[] = []
  for (const [file, css] of Object.entries(SKIN_CSS)) {
    for (const rule of cssRules(css)) {
      const z = /(?:^|[;\s])z-index\s*:\s*(-?\d+)/.exec(rule.body)
      if (!z) continue
      for (const selector of rule.selector.split(',')) {
        found.push({ file, selector: selector.trim(), z: Number(z[1]) })
      }
    }
  }
  return found
}

/**
 * Whether a selector's *subject* — its last compound, the element the rule actually
 * stacks — is the panel element. `.cb-panel-lift .cb-bubble-clip` stacks the wrapper and
 * is not one; `.cb-panel.clickable` is.
 */
function stacksThePanel(selector: string): boolean {
  const subject = selector.split(/[\s>+~]+/).filter(Boolean).pop() ?? ''
  const classes = [...subject.matchAll(/\.([\w-]+)/g)].map(m => m[1])
  return classes.some(c => c === 'cb-panel' || c === 'cb-panel-lift' || c === 'cb-panel-reveal')
}

/** The one z-index set on `selector`; fails loudly rather than defaulting when absent. */
function zOf(selector: string): number {
  const hit = layers().filter(l => l.selector === selector)
  expect(hit, `no rule for ${selector}`).toHaveLength(1)
  return hit[0].z
}

describe('the hovered panel does not paint out its own ink', () => {
  // Asserted non-empty first, content and all: a stylesheet that resolved to nothing
  // makes every assertion below vacuously true, which is exactly how the `?raw` glob
  // this reader replaced went unnoticed (see skinCss.ts).
  it('finds the skin\'s stylesheets, with their contents', () => {
    const files = Object.keys(SKIN_CSS)

    expect(files.length).toBeGreaterThan(5)
    expect(files.filter(f => SKIN_CSS[f].trim() === '')).toEqual([])
    expect(layers().length).toBeGreaterThan(5)
  })

  it('keeps every panel-level layer at or below the ink', () => {
    const ink = zOf('.cb-panel-svg')
    const over = layers()
      .filter(l => stacksThePanel(l.selector) && l.z > ink)
      .map(l => `${l.file}: ${l.selector} { z-index: ${l.z} }`)

    // At or below, not strictly below: `.cb-panel-reveal` ties with the ink and the SVG
    // is painted later in the DOM, so the ink still wins. Above it, a panel covers the
    // inner half of the stroke around its own polygon.
    expect(over).toEqual([])
  })

  it('lifts a hovered panel\'s clipped balloons over the ink, below the tubes', () => {
    const lifted = zOf('.cb-panel-lift .cb-bubble-clip')

    expect(lifted).toBeGreaterThan(zOf('.cb-panel-svg'))
    expect(lifted).toBeLessThan(zOf('.cb-tube-svg'))
    // The wrapper's resting z-index is what makes the lift necessary: it is a stacking
    // context below the ink, so the balloon it holds cannot escape on its own.
    expect(zOf('.cb-bubble-clip')).toBeLessThan(zOf('.cb-panel-svg'))
  })

  it('puts the lift class on the panel and a clipped balloon under it', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <ComicPanel
          index={0}
          info={PANEL}
          poly={{ vp: VP, bounds: BOUNDS }}
          images={[]}
          bubbles={[CLIPPED_BUBBLE]}
          chains={[]}
          callScenes={[]}
          sms={idleSms()}
          natSizes={{}}
          editorActive={false}
          hovered
          isRevealed={() => false}
          isBubbleVisible={() => true}
          dotRef={() => undefined}
          onSettled={() => undefined}
          onNatSize={() => undefined}
        />
      </MemoryRouter>,
    )
    const panel = container.querySelector<HTMLElement>('.cb-panel')!

    expect(panel.classList.contains('cb-panel-lift')).toBe(true)
    expect(panel.querySelector('.cb-bubble-clip')).not.toBeNull()
    // The inline styles place the panel; none of them stacks it. A z-index written here
    // would outrank the stylesheet and bring the whole bug back past the tests above.
    expect(panel.style.zIndex).toBe('')
  })

  // The selector reader is asserted against both answers, so a green run above means
  // "no such rule" rather than "the matcher never fires".
  it('reads a selector\'s subject rather than the whole selector', () => {
    expect(stacksThePanel('.cb-panel-lift')).toBe(true)
    expect(stacksThePanel('.cb-panel.clickable')).toBe(true)
    expect(stacksThePanel('.cb-panel-lift .cb-bubble-clip')).toBe(false)
    expect(stacksThePanel('.cb-dots-panel-canvas')).toBe(false)
  })
})
