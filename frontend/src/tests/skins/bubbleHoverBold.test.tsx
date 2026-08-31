import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import PanelBubble from '../../skins/comic-book/PanelBubble'
import PanelBubbleChain from '../../skins/comic-book/PanelBubbleChain'
import PanelBubbles from '../../skins/comic-book/PanelBubbles'
import type { BubbleChain } from '../../skins/comic-book/bubbleChain'
import BubbleInspector from '../../skins/comic-book/editor/BubbleInspector'
import { NEW_BUBBLE, seedConfig } from '../../skins/comic-book/editor/configSeed'
import { serializeConfig } from '../../skins/comic-book/editor/serialize'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'
import { idleSms } from './smsStub'

/** The box a balloon's percentages are measured against — the panel's, or half of one. */
const PANEL_BOX = { x: 0, y: 0, w: 400, h: 300 }

// `hoverBold`: the third thing a balloon can do about the pointer, beside the two shape
// morphs. Weight is a stroke rather than a shape, so it is a class and a stroke-width and
// not a fourth entry in SHAPES.
//
// Half of what these assert is what the option must *not* reach. The bold is confined by
// where the hover lives — PanelBubble's own state — so a linked partner, the tube welded
// between the two and every other row of a chain are separate renders that never see it.
// That confinement is the requirement, so it is asserted directly rather than left to
// follow from the implementation.

const bubble = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  ...NEW_BUBBLE,
  panel: 0,
  hoverBold: true,
  ...over,
})

const roots = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll('.cb-panel-bubble')] as HTMLElement[]

const bolded = (container: HTMLElement): HTMLElement[] =>
  roots(container).filter(el => el.classList.contains('is-bold'))

describe('a balloon that bolds on hover', () => {
  it('inks its outline heavier while the pointer is over it, and only while', () => {
    const { container } = render(<PanelBubble bubble={bubble()} visible interactive />)
    const root = roots(container)[0]

    expect(root.classList).not.toContain('is-bold')

    fireEvent.pointerEnter(root)
    expect(root.classList).toContain('is-bold')

    fireEvent.pointerLeave(root)
    expect(root.classList).not.toContain('is-bold')
  })

  it('leaves a balloon without the option at its resting weight', () => {
    const { container } = render(
      <PanelBubble bubble={bubble({ hoverBold: false })} visible interactive />,
    )
    const root = roots(container)[0]

    fireEvent.pointerEnter(root)

    expect(root.classList).not.toContain('is-bold')
  })

  it('stays put in edit mode, where the overlay owns the pointer', () => {
    const { container } = render(
      <PanelBubble bubble={bubble()} visible interactive={false} />,
    )
    const root = roots(container)[0]

    fireEvent.pointerEnter(root)

    expect(root.classList).not.toContain('is-bold')
  })

  it('carries the tail and the thought puffs inside the bolded element', () => {
    // The stem bolds with the balloon because it is not a second drawing: the tail is one
    // vertex of the same ring, and a cloud's puffs carry the same class one level down.
    // Both therefore sit under the element the class lands on, which is what lets the
    // CSS say it once. A tail extracted into a <path> of its own would break this.
    const { container } = render(
      <PanelBubble bubble={bubble({ type: 'cloud', tail: 'down-left' })} visible interactive />,
    )
    const root = roots(container)[0]

    fireEvent.pointerEnter(root)

    expect(root.classList).toContain('is-bold')
    expect(root.querySelectorAll('path.cb-bubble-shape')).toHaveLength(1) // ring + tail, one path
    expect(root.querySelectorAll('.cb-bubble-puffs circle.cb-bubble-shape').length).toBeGreaterThan(0)
  })
})

describe('the bold stops at the balloon under the pointer', () => {
  it('leaves a tube-linked partner at its own weight', () => {
    const pair = [bubble({ linkTo: 1, text: 'first' }), bubble({ text: 'second' })]
    const { container } = render(
      <PanelBubbles
        bubbles={pair}
        chains={[]}
        panel={0}
        bounds={PANEL_BOX}
        clip="none"
        isVisible={() => true}
        interactive
        editing={false}
        sms={idleSms()}
      />,
    )
    const [first, second] = roots(container)

    fireEvent.pointerEnter(first)

    expect(bolded(container)).toEqual([first])
    expect(second.classList).not.toContain('is-bold')
  })

  it('leaves the other rows of a chain at theirs', () => {
    // Every row is stamped from a template that has the option on, so all of them *can*
    // bold — the point is that hovering one is not hovering the column.
    const chain: BubbleChain = {
      id: 'chain-1',
      grow: false,
      stepMs: 900,
      rows: 3,
      sms: false,
      messages: ['hello', '> hi back', 'and again'],
    }
    const members = [
      bubble({ top: 60, right: 5, width: 40, tail: 'down-left', chain: 'chain-1' }),
      bubble({ top: 60, right: 55, width: 40, tail: 'down-right', chain: 'chain-1' }),
    ]
    const { container } = render(
      <PanelBubbleChain chain={chain} members={members} visible interactive />,
    )
    const rows = roots(container)
    expect(rows.length).toBeGreaterThan(1)

    fireEvent.pointerEnter(rows[1])

    expect(bolded(container)).toEqual([rows[1]])
  })
})

describe('the stylesheet behind the class', () => {
  // Read as source, the way comicBookImageBorders.test.tsx does: `import.meta.glob`
  // resolves at build time, so there is no `node:fs` and no `__dirname` to get past
  // `lint:types`, and a rule written in any of the skin's stylesheets is still seen.
  const CSS = import.meta.glob('../../skins/comic-book/**/*.css', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>

  /** `selector { body }` pairs, comments stripped — a comment may name a token freely. */
  function rules(): { selector: string; body: string }[] {
    return Object.values(CSS).flatMap(css =>
      [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
        selector: m[1].trim(),
        body: m[2],
      })),
    )
  }

  // Asserted before anything is read out of it: vitest stubs a CSS request to `''` unless
  // the file is in `test.css.include`, and every `find` below would come back undefined —
  // green, having compared nothing. That is not hypothetical; see the config comment.
  it('reads the skin stylesheets as source', () => {
    const sources = Object.values(CSS)
    expect(sources.length).toBeGreaterThan(5)
    expect(sources.every(css => css.length > 0)).toBe(true)
    expect(rules().length).toBeGreaterThan(20)
  })

  it('raises the outline weight on .is-bold, and the outline reads it', () => {
    const all = rules()
    const bold = all.find(r => r.selector === '.cb-panel-bubble.is-bold')
    const shape = all.find(r => r.selector === '.cb-bubble-shape')

    expect(bold?.body).toMatch(/--cb-bubble-ink:\s*(\d+(\.\d+)?)/)
    expect(shape?.body).toMatch(/stroke-width:\s*var\(--cb-bubble-ink,\s*4\)/)
    // Heavier than the resting 4, or the class draws nothing.
    const raised = Number(/--cb-bubble-ink:\s*([\d.]+)/.exec(bold?.body ?? '')?.[1])
    expect(raised).toBeGreaterThan(4)
  })

  it('leaves the connector tube rails on a weight of their own', () => {
    // A corridor is one utterance crossing two balloons. Thickening only the half welded
    // to the hovered balloon would read as the drawing coming apart, so the rails take a
    // literal and never the balloon's token.
    const rail = rules().find(r => r.selector === '.cb-tube-rail')

    expect(rail?.body).toMatch(/stroke-width:\s*4/)
    expect(rail?.body).not.toMatch(/--cb-bubble-ink/)
  })
})

describe('authoring the option', () => {
  function editorApi(bubbles: BubbleTransform[]) {
    return { config: { ...seedConfig(), bubbles }, setBubble: vi.fn() } as unknown as EditorModeApi
  }

  it('offers a checkbox that writes the field', () => {
    const api = editorApi([bubble({ hoverBold: false })])
    render(<BubbleInspector api={api} index={0} bubble={api.config.bubbles[0]} />)
    const box = screen.getByLabelText('Bolder outline on hover') as HTMLInputElement

    expect(box.checked).toBe(false)
    fireEvent.click(box)

    expect(api.setBubble).toHaveBeenCalledWith(0, { hoverBold: true })
  })

  it('shows the box ticked for a balloon that already has it', () => {
    const api = editorApi([bubble()])
    render(<BubbleInspector api={api} index={0} bubble={api.config.bubbles[0]} />)

    expect((screen.getByLabelText('Bolder outline on hover') as HTMLInputElement).checked).toBe(true)
  })

  it('serializes into layoutConfig.ts beside the two morph targets', () => {
    const off = seedConfig()
    expect(serializeConfig(off)).toContain('hoverBold: false,')

    const on = seedConfig()
    on.bubbles[0] = { ...on.bubbles[0], hoverBold: true }

    expect(serializeConfig(on)).toContain('hoverBold: true,')
  })
})
