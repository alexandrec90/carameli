import { fireEvent, render, screen } from '@testing-library/react'
import { createElement, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BubbleDial from '../../skins/comic-book/BubbleDial'

// A dial balloon is an autocomplete whose list is a wheel, so every case here is really
// the same question: after this gesture, is the field lettering the row the drum is on?

const OPTIONS = ['2345679999', '5550001111', '5550002222']
const FIRST = '(234) 567-9999'
const SECOND = '(555) 000-1111'
const THIRD = '(555) 000-2222'

beforeEach(() => vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']))
afterEach(() => vi.restoreAllMocks())

interface HarnessProps {
  options?: string[]
  initial?: string
  enabled?: boolean
  onSubmit?: (value: string) => void
  onChange?: (value: string) => void
}

/**
 * The panel's half of the arrangement: BubbleDial is fully controlled, and the wheel
 * listener goes on the balloon's root rather than on the picker's own box, so a test
 * has to supply both the value and the host element.
 */
function Harness({ options = OPTIONS, initial = FIRST, enabled = true, onSubmit, onChange }: HarnessProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState(initial)
  return (
    <div ref={hostRef} data-testid="host">
      <BubbleDial
        options={options}
        value={value}
        onChange={next => {
          onChange?.(next)
          setValue(next)
        }}
        font="Comic Neue"
        open
        enabled={enabled}
        hostRef={hostRef}
        onSubmit={onSubmit}
      />
    </div>
  )
}

function draw(props: HarnessProps = {}) {
  const view = render(<Harness {...props} />)
  return {
    ...view,
    host: screen.getByTestId('host'),
    field: screen.getByRole('textbox', { name: 'Phone number' }) as HTMLInputElement,
    /** The rows the drum is showing — the shortlist as the typed number has narrowed it. */
    rows: () =>
      Array.from(view.container.querySelectorAll('.cb-wheel-option')).map(r => r.textContent),
    selected: () => view.container.querySelector('.cb-wheel-option.is-selected')?.textContent,
  }
}

describe('BubbleDial as a wheel', () => {
  it('draws the shortlist behind the field and starts on the value it was given', () => {
    const { field, rows, selected } = draw()

    expect(rows()).toEqual(OPTIONS)
    expect(field.value).toBe(FIRST)
    expect(selected()).toBe(OPTIONS[0])
  })

  it('turns to the next option on a scroll, reporting it formatted', () => {
    const onChange = vi.fn()
    const { host, field, selected } = draw({ onChange })

    fireEvent.wheel(host, { deltaY: 60 })

    expect(onChange).toHaveBeenCalledWith(SECOND)
    expect(field.value).toBe(SECOND)
    expect(selected()).toBe(OPTIONS[1])
  })

  it('turns on the arrow keys as well, so the options are reachable without a mouse', () => {
    const { field, selected } = draw()

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selected()).toBe(OPTIONS[1])
    expect(field.value).toBe(SECOND)

    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(selected()).toBe(OPTIONS[0])
    expect(field.value).toBe(FIRST)
  })

  it('stops at the ends rather than wrapping', () => {
    const { host, field, selected } = draw()

    // Up off the first option would be the typed row, which is empty here — nothing has
    // been typed, so there is nothing to go back to and the drum stays put.
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(selected()).toBe(OPTIONS[0])
    expect(field.value).toBe(FIRST)

    for (let i = 0; i < 5; i += 1) fireEvent.wheel(host, { deltaY: 60 })
    expect(selected()).toBe(OPTIONS[2])
  })

  it('keeps turning through a fast scroll instead of stopping after the first step', () => {
    // The listener is registered once per host, so a handler reading the index of the
    // render that registered it would swallow every turn but the first.
    const { host, selected } = draw()

    fireEvent.wheel(host, { deltaY: 60 })
    fireEvent.wheel(host, { deltaY: 60 })

    expect(selected()).toBe(OPTIONS[2])
  })

  it('does not turn while the editor overlay owns the balloon', () => {
    const onChange = vi.fn()
    const { host, field } = draw({ enabled: false, onChange })

    fireEvent.wheel(host, { deltaY: 60 })

    expect(onChange).not.toHaveBeenCalled()
    expect(field.disabled).toBe(true)
    expect(field.tabIndex).toBe(-1)
  })

  it('draws a bare field when the author listed no options', () => {
    const { host, field, rows } = draw({ options: [], initial: '' })

    fireEvent.wheel(host, { deltaY: 60 })

    expect(rows()).toEqual([])
    expect(field.value).toBe('')
  })
})

describe('BubbleDial as a filter', () => {
  it('narrows the drum to what the typed number could still be', () => {
    const { field, rows } = draw({ initial: '' })

    fireEvent.change(field, { target: { value: '555' } })

    expect(rows()).toEqual([OPTIONS[1], OPTIONS[2]])
  })

  it('leaves nothing picked while the reader is typing: the field is the row', () => {
    const { field, selected } = draw({ initial: '' })

    fireEvent.change(field, { target: { value: '5550002222' } })

    expect(field.value).toBe(THIRD)
    expect(selected()).toBeUndefined()
  })

  it('empties the drum for a number nothing on the list carries, keeping the number', () => {
    // The field is free to say something the shortlist cannot — that is the whole point
    // of a dial over a wheel.
    const { field, rows } = draw()

    fireEvent.change(field, { target: { value: '9998887777' } })

    expect(field.value).toBe('(999) 888-7777')
    expect(rows()).toEqual([])
  })

  it('turns through the narrowed list rather than the whole one', () => {
    const { field, selected } = draw({ initial: '' })

    fireEvent.change(field, { target: { value: '555' } })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selected()).toBe(OPTIONS[1])

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selected()).toBe(OPTIONS[2])

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selected()).toBe(OPTIONS[2])
  })

  it('gives the reader their own number back when the drum is turned up off the list', () => {
    const { field, selected } = draw({ initial: '' })

    fireEvent.change(field, { target: { value: '555' } })
    // As the formatter left it when it was typed: three US digits are already bracketed,
    // so this is the reader's own half-typed number and not a new one.
    expect(field.value).toBe('(555)')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(field.value).toBe(SECOND)

    fireEvent.keyDown(field, { key: 'ArrowUp' })

    expect(field.value).toBe('(555)')
    expect(selected()).toBeUndefined()
  })

  it('keeps the narrowed list while the drum moves through it', () => {
    // The filter is what was typed, not what the drum lands on: re-filtering from the
    // picked row would collapse the list to one entry on the first turn.
    const { field, rows } = draw({ initial: '' })

    fireEvent.change(field, { target: { value: '555' } })
    fireEvent.keyDown(field, { key: 'ArrowDown' })

    expect(rows()).toEqual([OPTIONS[1], OPTIONS[2]])
  })

  it('restores the whole shortlist when the number is cleared', () => {
    const { field, rows } = draw()

    fireEvent.change(field, { target: { value: '555' } })
    fireEvent.change(field, { target: { value: '' } })

    expect(rows()).toEqual(OPTIONS)
  })

  it('re-seats the drum when a dialled number joins the shortlist', () => {
    // What ComicPanel does on Enter: the number the reader reached by typing becomes an
    // ordinary row, and the drum lands on it with the filter cleared.
    const dialled = '(999) 888-7777'
    const { rerender } = render(<Harness initial={dialled} />)
    rerender(<Harness options={[...OPTIONS, dialled]} initial={dialled} />)

    const rows = Array.from(document.querySelectorAll('.cb-wheel-option')).map(r => r.textContent)
    expect(rows).toEqual([...OPTIONS, dialled])
    expect(document.querySelector('.cb-wheel-option.is-selected')?.textContent).toBe(dialled)
  })
})

describe('BubbleDial as a phone field', () => {
  it('formats what is typed and exposes phone keyboard semantics', () => {
    const { field } = draw({ initial: '' })

    fireEvent.change(field, { target: { value: '12345679999' } })

    expect(field.value).toBe('1 (234) 567-9999')
    expect(field.type).toBe('tel')
    expect(field.inputMode).toBe('tel')
  })

  it('backspaces through formatting punctuation by removing the adjacent digit', () => {
    const { field } = draw()
    field.setSelectionRange(6, 6)

    fireEvent.keyDown(field, { key: 'Backspace' })

    expect(field.value).toBe('(235) 679-999')
  })

  it('dials on Enter and keeps the number on the display', () => {
    // Unlike a chain composer, which clears: the number stays up after it is dialled,
    // the way it does on the phone in the picture.
    const onSubmit = vi.fn()
    const { field } = draw({ onSubmit })

    fireEvent.keyDown(field, { key: 'Enter' })

    expect(onSubmit).toHaveBeenCalledWith(FIRST)
    expect(field.value).toBe(FIRST)
  })

  it('dials nothing from an empty field, or on a modified Enter', () => {
    const onSubmit = vi.fn()
    const { field } = draw({ initial: '', onSubmit })

    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.change(field, { target: { value: '5550001111' } })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not send its clicks or keys to the navigable panel beneath it', () => {
    const click = vi.fn()
    const keyDown = vi.fn()
    // createElement rather than JSX: a listening <div> is a static element with handlers,
    // which is exactly what the rule about non-native interactive elements is for — and
    // here the point of the test is that the balloon beneath is navigable.
    render(
      createElement('div', { onClick: click, onKeyDown: keyDown }, createElement(Harness)),
    )
    const [field] = screen.getAllByRole('textbox', { name: 'Phone number' })

    fireEvent.click(field)
    fireEvent.keyDown(field, { key: 'Enter' })

    expect(click).not.toHaveBeenCalled()
    expect(keyDown).not.toHaveBeenCalled()
  })
})
