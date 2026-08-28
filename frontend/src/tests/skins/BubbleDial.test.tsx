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
  revealed?: boolean
  onSubmit?: (value: string) => void
  onChange?: (value: string, fresh: boolean) => void
}

/**
 * The panel's half of the arrangement: BubbleDial is fully controlled, and the wheel
 * listener goes on the balloon's root rather than on the picker's own box, so a test
 * has to supply the value, the fresh flag (ComicPanel's rule: a seed is the drum's
 * number, so it starts fresh) and the host element. `revealed` defaults off so the
 * gesture tests exercise the drum, not the keyboard grab that reveal performs.
 */
function Harness({
  options = OPTIONS, initial = FIRST, enabled = true, revealed = false, onSubmit, onChange,
}: HarnessProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState(initial)
  const [fresh, setFresh] = useState(initial !== '')
  return (
    <div ref={hostRef} data-testid="host">
      <BubbleDial
        options={options}
        value={value}
        fresh={fresh}
        onChange={(next, nextFresh) => {
          onChange?.(next, nextFresh)
          setValue(next)
          setFresh(nextFresh)
        }}
        font="Comic Neue"
        open
        revealed={revealed}
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
  it('draws the shortlist behind the field, lettered formatted, starting on its value', () => {
    // Formatted however the author spelled the option: a drum of raw digit strings
    // beside a formatted field reads as two different kinds of thing.
    const { field, rows, selected } = draw()

    expect(rows()).toEqual([FIRST, SECOND, THIRD])
    expect(field.value).toBe(FIRST)
    expect(selected()).toBe(FIRST)
  })

  it('turns to the next option on a scroll, reporting it formatted', () => {
    const onChange = vi.fn()
    const { host, field, selected } = draw({ onChange })

    fireEvent.wheel(host, { deltaY: 60 })

    // Fresh: the drum supplied it, so the next key starts a new number over it.
    expect(onChange).toHaveBeenCalledWith(SECOND, true)
    expect(field.value).toBe(SECOND)
    expect(selected()).toBe(SECOND)
  })

  it('turns on the arrow keys as well, so the options are reachable without a mouse', () => {
    const { field, selected } = draw()

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selected()).toBe(SECOND)
    expect(field.value).toBe(SECOND)

    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(selected()).toBe(FIRST)
    expect(field.value).toBe(FIRST)
  })

  it('stops at the ends rather than wrapping', () => {
    const { host, field, selected } = draw()

    // Up off the first option would be the typed row, which is empty here — nothing has
    // been typed, so there is nothing to go back to and the drum stays put.
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(selected()).toBe(FIRST)
    expect(field.value).toBe(FIRST)

    for (let i = 0; i < 5; i += 1) fireEvent.wheel(host, { deltaY: 60 })
    expect(selected()).toBe(THIRD)
  })

  it('keeps turning through a fast scroll instead of stopping after the first step', () => {
    // The listener is registered once per host, so a handler reading the index of the
    // render that registered it would swallow every turn but the first.
    const { host, selected } = draw()

    fireEvent.wheel(host, { deltaY: 60 })
    fireEvent.wheel(host, { deltaY: 60 })

    expect(selected()).toBe(THIRD)
  })

  it('turns from anywhere over the panel while its balloon is revealed', () => {
    // The reveal hands the dial the panel's keyboard; the wheel gets the same reach,
    // so the reader does not have to park the pointer on one balloon to turn.
    render(
      <div className="cb-panel" data-testid="panel">
        <Harness revealed />
      </div>,
    )
    const field = screen.getByRole('textbox', { name: 'Phone number' }) as HTMLInputElement

    fireEvent.wheel(screen.getByTestId('panel'), { deltaY: 60 })

    expect(field.value).toBe(SECOND)
  })

  it('keeps the balloon-only reach while the panel is not revealing it', () => {
    render(
      <div className="cb-panel" data-testid="panel">
        <Harness />
      </div>,
    )
    const field = screen.getByRole('textbox', { name: 'Phone number' }) as HTMLInputElement

    fireEvent.wheel(screen.getByTestId('panel'), { deltaY: 60 })

    expect(field.value).toBe(FIRST)
  })

  it('leaves a wheel event another balloon on the panel has already taken', () => {
    // A chain's scrollback and a wheel picker preventDefault on their own roots, which
    // are descendants of the panel, so their listeners run first. Taken means taken:
    // the drum must not also turn on the same flick.
    render(
      <div className="cb-panel" data-testid="panel">
        <Harness revealed />
      </div>,
    )
    const field = screen.getByRole('textbox', { name: 'Phone number' }) as HTMLInputElement
    screen.getByTestId('panel').addEventListener('wheel', e => e.preventDefault(), {
      capture: true,
    })

    fireEvent.wheel(screen.getByTestId('host'), { deltaY: 60, cancelable: true })

    expect(field.value).toBe(FIRST)
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

    expect(rows()).toEqual([SECOND, THIRD])
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
    expect(selected()).toBe(SECOND)

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selected()).toBe(THIRD)

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selected()).toBe(THIRD)
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

    expect(rows()).toEqual([SECOND, THIRD])
  })

  it('restores the whole shortlist when the number is cleared', () => {
    const { field, rows } = draw()

    fireEvent.change(field, { target: { value: '555' } })
    fireEvent.change(field, { target: { value: '' } })

    expect(rows()).toEqual([FIRST, SECOND, THIRD])
  })

  it('re-seats the drum when a dialled number joins the shortlist', () => {
    // What ComicPanel does on Enter: the number the reader reached by typing becomes an
    // ordinary row, and the drum lands on it with the filter cleared.
    const dialled = '(999) 888-7777'
    const { rerender } = render(<Harness initial={dialled} />)
    rerender(<Harness options={[...OPTIONS, dialled]} initial={dialled} />)

    const rows = Array.from(document.querySelectorAll('.cb-wheel-option')).map(r => r.textContent)
    expect(rows).toEqual([FIRST, SECOND, THIRD, dialled])
    expect(document.querySelector('.cb-wheel-option.is-selected')?.textContent).toBe(dialled)
  })
})

describe('BubbleDial as a phone field', () => {
  it('formats what is typed and exposes phone keyboard semantics', () => {
    const { field } = draw({ initial: '' })

    fireEvent.change(field, { target: { value: '12345679999' } })

    expect(field.value).toBe('1 (234) 567-9999')
    // text + inputMode rather than type="tel", and autocomplete off: `tel` invites
    // Chrome to draw its own phone-number dropdown over the drum. The numeric keyboard
    // on touch comes from inputMode alone.
    expect(field.type).toBe('text')
    expect(field.inputMode).toBe('tel')
    expect(field.autocomplete).toBe('off')
  })

  it('backspaces through formatting punctuation by removing the adjacent digit', () => {
    // Typed by the reader, not seeded: their own number edits one digit at a time.
    const { field } = draw({ initial: '' })
    fireEvent.change(field, { target: { value: '2345679999' } })
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

  it('takes the keyboard when its panel reveals it, caret parked at the end', () => {
    // The dial is the panel's only input, so hovering the panel is reaching for it: no
    // click needed. No selection: the number shows in plain ink, and what the next
    // keystroke does to it is the fresh flag's decision, not a highlight's — a
    // select-all here painted the number in the browser's own selection colours.
    const { field } = draw({ revealed: true })

    expect(document.activeElement).toBe(field)
    expect(field.selectionStart).toBe(field.value.length)
    expect(field.selectionEnd).toBe(field.value.length)
  })

  it('starts a new number over the seeded option, instead of appending to it', () => {
    // The seed is the drum's number, already finished: growing it digit by digit could
    // only produce a number no option contains, emptying the shortlist on the first key.
    const { field, rows } = draw({ revealed: true })

    fireEvent.keyDown(field, { key: '9' })

    expect(field.value).toBe('9')
    expect(rows()).toEqual([FIRST])
  })

  it('clears a drum-supplied number whole on Backspace, restoring the shortlist', () => {
    const { field, rows } = draw({ revealed: true })

    fireEvent.keyDown(field, { key: 'Backspace' })

    expect(field.value).toBe('')
    expect(rows()).toEqual([FIRST, SECOND, THIRD])
  })

  it('gives the keyboard back when the panel hides it', () => {
    const { field, rerender } = draw({ revealed: true })
    expect(document.activeElement).toBe(field)

    rerender(<Harness revealed={false} />)

    expect(document.activeElement).not.toBe(field)
  })

  it('does not grab the keyboard while the editor overlay owns the balloon', () => {
    const { field } = draw({ revealed: true, enabled: false })

    expect(document.activeElement).not.toBe(field)
  })

  it('replaces a number the drum turns to with the next keystroke, like the seed', () => {
    const { host, field } = draw({ revealed: true })

    fireEvent.wheel(host, { deltaY: 60 })
    expect(field.value).toBe(SECOND)

    fireEvent.keyDown(field, { key: '9' })

    expect(field.value).toBe('9')
  })

  it('goes on appending when the drum returns to the reader’s own number', () => {
    // Row 0 is the half-typed number handed back, not one the drum supplied: a fresh
    // start there would make the next digit erase what they were in the middle of
    // typing, so the keydown is left to native editing.
    const { field } = draw({ initial: '', revealed: true })

    fireEvent.change(field, { target: { value: '555' } })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(field.value).toBe('(555)')

    fireEvent.keyDown(field, { key: '0' })

    // jsdom performs no native insertion, so an unchanged value proves the key was not
    // intercepted — a fresh start here would have lettered '0' alone.
    expect(field.value).toBe('(555)')
  })

  it('inks its comic caret only where typing would append, never over a drum number', () => {
    const { container, field, rerender } = draw({ revealed: true })
    const caret = container.querySelector('.cb-dial-caret') as HTMLElement

    // The reveal focused a fresh, drum-supplied number: the next key replaces it
    // whole, so there is no insertion point for a caret to promise.
    expect(caret.style.visibility).toBe('hidden')

    // Typing makes the number the reader's own — appending now, so the caret shows.
    fireEvent.change(field, { target: { value: '555' } })
    expect(caret.style.visibility).toBe('visible')

    // Turning the drum letters one of its numbers again: fresh, caret back out.
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(caret.style.visibility).toBe('hidden')

    rerender(<Harness revealed={false} />)
    expect(caret.style.visibility).toBe('hidden')
  })

  it('inks the caret again when the panel re-reveals a half-typed number', () => {
    // Leaving the panel and coming back does not finish the number: it is still the
    // reader's own, typing still appends, so the caret comes back with the focus.
    const { container, field, rerender } = draw({ revealed: true })
    const caret = container.querySelector('.cb-dial-caret') as HTMLElement

    fireEvent.change(field, { target: { value: '555' } })
    rerender(<Harness revealed={false} />)
    expect(caret.style.visibility).toBe('hidden')

    rerender(<Harness revealed />)

    expect(caret.style.visibility).toBe('visible')
  })

  it('hides the caret across a selection the reader makes themselves', () => {
    const { container, field } = draw({ initial: '', revealed: true })
    const caret = container.querySelector('.cb-dial-caret') as HTMLElement
    fireEvent.change(field, { target: { value: '555' } })

    // Ctrl+A: a selection paints itself, so a block caret on it is a second highlight.
    field.setSelectionRange(0, 4)

    expect(caret.style.visibility).toBe('hidden')
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
