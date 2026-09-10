import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import Hint from '../../skins/comic-book/editor/Hint'
import ImageInspector from '../../skins/comic-book/editor/ImageInspector'
import InspectorPanel from '../../skins/comic-book/editor/InspectorPanel'
import Section from '../../skins/comic-book/editor/Section'
import { newTable } from '../../skins/comic-book/editor/tableValidate'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'

// What keeps the editor's control panel from covering the page.
//
// The complaint this answers is a measurement, not a taste: `useToolbarColumns` converts
// toolbar *height* into toolbar *width*, so every paragraph of prose and every full-width
// coordinate field is paid for in screen area. A picture carrying a projected table was
// stacking about twenty lines of explanation and eight stacked corner fields, and the
// answer was a three-column panel over most of the drawing.
//
// So the properties worth holding are: the prose is reachable but costs no block, the
// big set-once blocks start folded, and folding never puts an edit out of reach.

function editorApi(config = seedConfig()) {
  return {
    config,
    setImg: vi.fn(),
    setBubble: vi.fn(),
    setPanelLabel: vi.fn(),
    resetOne: vi.fn(),
    deleteImg: vi.fn(),
    deleteBubble: vi.fn(),
  } as unknown as EditorModeApi
}

describe('Hint', () => {
  it('carries the whole paragraph, in the tooltip and to a screen reader alike', () => {
    const text = 'Higher draws in front of the other pictures on this panel.'
    render(<Hint text={text} />)

    expect(screen.getByTitle(text)).toBeTruthy()
    expect(screen.getByLabelText(text)).toBeTruthy()
  })

  // The whole point: a hint must not be a block of text in the flow any more. It is one
  // character on a line that already exists.
  it('renders one character, not a paragraph', () => {
    render(<Hint text={'a '.repeat(200)} />)

    expect(screen.getByRole('note').textContent?.trim()).toBe('?')
  })
})

describe('Section', () => {
  it('starts folded, and opens on the heading', () => {
    render(
      <Section title="corners">
        <button type="button">inside</button>
      </Section>,
    )

    expect(screen.queryByRole('button', { name: 'inside' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'corners' }))
    expect(screen.getByRole('button', { name: 'inside' })).toBeTruthy()
  })

  it('folds again, so a block an author is done with stops costing the toolbar height', () => {
    render(
      <Section title="corners" defaultOpen>
        <button type="button">inside</button>
      </Section>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'corners' }))
    expect(screen.queryByRole('button', { name: 'inside' })).toBeNull()
  })

  // The caret is CSS, drawn off `aria-expanded`. If it were rendered text it would land in
  // the button's `textContent`, which is where `editorStates.ts` reads a control's name —
  // every folded block would be renamed in the control-surface snapshot.
  it('names itself with the title alone, and reports its state to assistive tech', () => {
    render(<Section title="columns & rows">x</Section>)
    const toggle = screen.getByRole('button', { name: 'columns & rows' })

    expect(toggle.textContent).toBe('columns & rows')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('puts its paragraph on the heading rather than in the block', () => {
    render(<Section title="corners" hint="Drag the round blue grips onto the ruled area.">x</Section>)

    expect(screen.getByTitle(/round blue grips/)).toBeTruthy()
  })
})

describe('the picture inspector, compacted', () => {
  it('explains depth in a tooltip instead of six lines of the toolbar', () => {
    const image = seedConfig().images[0]
    render(<ImageInspector api={editorApi()} index={0} image={image} />)

    expect(screen.getByTitle(/Higher draws in front of the other pictures/)).toBeTruthy()
    expect(screen.queryByText(/Higher draws in front of the other pictures/)).toBeNull()
  })

  // The state the report was about: a notepad with a table projected onto it. Both of the
  // tall blocks it opens start folded, and neither loses an edit by being folded.
  it('ships a projected surface folded, and gives every corner back on one click', () => {
    const api = editorApi()
    const image = { ...seedConfig().images[0], table: newTable() }
    render(<ImageInspector api={api} index={0} image={image} />)

    expect(screen.queryByLabelText('bottom-right Y %')).toBeNull()
    expect(screen.queryByLabelText('heading')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'corners' }))
    fireEvent.change(screen.getByLabelText('bottom-right Y %'), { target: { value: '61.5' } })

    const [, patch] = (api.setImg as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(patch.table.quad[2]).toEqual([image.table?.quad[2]?.[0] ?? 100, 61.5])
  })

  it('keeps the surface switches themselves on screen — folding is for the detail', () => {
    const image = { ...seedConfig().images[0], table: newTable() }
    render(<ImageInspector api={editorApi()} index={0} image={image} />)

    expect(screen.getByLabelText('Project a table on this picture')).toBeTruthy()
    expect(screen.getByLabelText('Project a number pad on this picture')).toBeTruthy()
    expect(screen.getByLabelText('shows')).toBeTruthy()
    expect(screen.getByLabelText('rows')).toBeTruthy()
  })
})

describe('the selection read-out', () => {
  // Seven live numbers were the second tallest block in the toolbar, for something the
  // page is already showing under the cursor.
  it('folds the picture read-out away, and gives every figure back on one click', () => {
    const config = seedConfig()
    const index = config.images.findIndex(i => !i.table && !i.numberPad)
    const api = editorApi(config)
    render(
      <InspectorPanel api={{ ...api, selected: { kind: 'img', index } }} panel={config.images[index].panel} />,
    )

    expect(screen.queryByText('offsetY')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'position' }))
    for (const field of ['left', 'top', 'width', 'height', 'scale', 'offsetX', 'offsetY']) {
      expect(screen.getByText(field)).toBeTruthy()
    }
  })

  it('offers the keyboard gestures as a tooltip on the heading', () => {
    const config = seedConfig()
    const index = config.images.findIndex(i => !i.table && !i.numberPad)
    const api = editorApi(config)
    render(
      <InspectorPanel api={{ ...api, selected: { kind: 'img', index } }} panel={config.images[index].panel} />,
    )

    expect(screen.getByTitle(/the round grip pans the picture inside/)).toBeTruthy()
  })
})
