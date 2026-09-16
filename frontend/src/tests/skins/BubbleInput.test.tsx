import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BubbleInput from '../../skins/comic-book/BubbleInput'

afterEach(() => vi.restoreAllMocks())

describe('BubbleInput', () => {
  it('renders an enabled, editable plain-text field without changing punctuation', () => {
    render(<BubbleInput kind="input" initialValue="Your name" shape="soft" font="Comic Neue" enabled />)
    const input = screen.getByRole('textbox', { name: 'Speech bubble text' }) as HTMLInputElement

    fireEvent.change(input, { target: { value: 'A. Person' } })

    expect(input.value).toBe('A. Person')
    expect(input.disabled).toBe(false)
    expect(input.tabIndex).toBe(0)
  })

  it('formats a phone number live and exposes phone keyboard semantics', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
    render(<BubbleInput kind="phone" initialValue="" shape="soft" font="Comic Neue" enabled />)
    const input = screen.getByRole('textbox', { name: 'Phone number' }) as HTMLInputElement

    fireEvent.change(input, { target: { value: '12345679999' } })

    expect(input.value).toBe('1 (234) 567-9999')
    expect(input.type).toBe('tel')
    expect(input.inputMode).toBe('tel')
  })

  it('backspaces through formatting punctuation by removing the adjacent digit', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
    render(
      <BubbleInput
        kind="phone"
        initialValue="(234) 567-9999"
        shape="soft"
        font="Comic Neue"
        enabled
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Phone number' }) as HTMLInputElement
    input.setSelectionRange(6, 6)

    fireEvent.keyDown(input, { key: 'Backspace' })

    expect(input.value).toBe('(235) 679-999')
  })

  it('cannot take focus while the bubble is owned by the editor overlay', () => {
    render(<BubbleInput kind="input" initialValue="Draft" shape="soft" font="Comic Neue" enabled={false} />)
    const input = screen.getByRole('textbox', { name: 'Speech bubble text' }) as HTMLInputElement

    expect(input.disabled).toBe(true)
    expect(input.tabIndex).toBe(-1)
  })

  it('takes the keyboard on reveal and draws the same comic caret as the dial', () => {
    const { container, rerender } = render(
      <BubbleInput kind="input" initialValue="Draft" shape="soft" font="Comic Neue" enabled revealed />,
    )
    const input = screen.getByRole('textbox', { name: 'Speech bubble text' }) as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(container.querySelector('.cb-dial-caret')).not.toBeNull()

    rerender(<BubbleInput kind="input" initialValue="Draft" shape="soft" font="Comic Neue" enabled />)
    expect(document.activeElement).not.toBe(input)
  })

  // The block the words are drawn in is the one the fit wrapped them against — the
  // balloon's *current* shape, not the stylesheet's fallback ellipse, or a composer in a
  // thought cloud would wrap wider than the balloon it was sized for.
  it('letters inside the block inscribed in the shape it is drawn as', () => {
    const { container } = render(
      <BubbleInput kind="input" initialValue="" shape="cloud" font="Comic Neue" enabled />,
    )
    const field = container.querySelector<HTMLElement>('.cb-bubble-field')
    expect(field?.style.inset).not.toBe('')
  })

  it('does not send input clicks or keys to the navigable panel beneath it', () => {
    const click = vi.fn()
    const keyDown = vi.fn()
    render(
      createElement(
        'div',
        { onClick: click, onKeyDown: keyDown },
        createElement(BubbleInput, {
          kind: 'input',
          initialValue: 'Draft',
          shape: 'soft',
          font: 'Comic Neue',
          enabled: true,
        }),
      ),
    )
    const input = screen.getByRole('textbox', { name: 'Speech bubble text' })

    fireEvent.click(input)
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(click).not.toHaveBeenCalled()
    expect(keyDown).not.toHaveBeenCalled()
  })
})

describe('BubbleInput as a chain composer', () => {
  const composer = (onSubmit: (value: string) => void) => {
    render(
      <BubbleInput
        kind="input"
        initialValue=""
        shape="soft"
        font="Comic Neue"
        enabled
        onSubmit={onSubmit}
      />,
    )
    return screen.getByRole('textbox', { name: 'Speech bubble text' }) as HTMLInputElement
  }

  it('sends on Enter and clears itself, ready for the next message', () => {
    const onSubmit = vi.fn()
    const input = composer(onSubmit)

    fireEvent.change(input, { target: { value: '  Hi there  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSubmit).toHaveBeenCalledWith('Hi there')
    expect(input.value).toBe('')
  })

  it('sends nothing on an empty field — a blank balloon is not a message', () => {
    const onSubmit = vi.fn()
    const input = composer(onSubmit)

    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  // Ctrl/Cmd/Alt+Enter belongs to the browser and the OS, not to the thread.
  it('leaves a modified Enter alone', () => {
    const onSubmit = vi.fn()
    const input = composer(onSubmit)

    fireEvent.change(input, { target: { value: 'Hi' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(input.value).toBe('Hi')
  })

  it('keeps what was typed when there is nothing to send to', () => {
    render(<BubbleInput kind="input" initialValue="" shape="soft" font="Comic Neue" enabled />)
    const input = screen.getByRole('textbox', { name: 'Speech bubble text' }) as HTMLInputElement

    fireEvent.change(input, { target: { value: 'Draft' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input.value).toBe('Draft')
  })
})

// A field whose balloon is being fitted to what is typed into it wraps instead of
// scrolling its words sideways — one question, asked through `onDraftChange`, because a
// field that wrapped without one would push its second line out through the outline.
describe('BubbleInput wrapping', () => {
  const field = (props: { onDraftChange?: (v: string) => void; kind?: 'input' | 'phone' } = {}) => {
    const { container } = render(
      <BubbleInput
        kind={props.kind ?? 'input'}
        initialValue=""
        shape="soft"
        font="Comic Neue"
        enabled
        onDraftChange={props.onDraftChange}
      />,
    )
    return container
  }

  it('is a textarea when something is sizing the balloon around it', () => {
    const container = field({ onDraftChange: vi.fn() })

    expect(container.querySelector('textarea.cb-bubble-input')).not.toBeNull()
    expect(container.querySelector('input.cb-bubble-input')).toBeNull()
    expect(container.querySelector('.cb-bubble-wrapping')).not.toBeNull()
  })

  it('stays a one-line input when nothing is', () => {
    const container = field()

    expect(container.querySelector('input.cb-bubble-input')).not.toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('.cb-bubble-wrapping')).toBeNull()
  })

  // A number is one line by nature, and the formatter, the digit-wise delete and the
  // caret arithmetic all read it as one.
  it('never wraps a phone field, whoever is listening to it', () => {
    const container = field({ kind: 'phone', onDraftChange: vi.fn() })

    expect(container.querySelector('input.cb-bubble-input')).not.toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('reports every keystroke, so the balloon is fitted to what is in it', () => {
    const onDraftChange = vi.fn()
    field({ onDraftChange })
    const area = screen.getByRole('textbox', { name: 'Speech bubble text' })

    fireEvent.change(area, { target: { value: 'a long message' } })

    expect(onDraftChange).toHaveBeenLastCalledWith('a long message')
  })

  // Sending empties the field, and a balloon still drawn tall around an empty composer
  // would be a balloon holding nothing.
  it('reports the field emptying when a message is sent', () => {
    const onDraftChange = vi.fn()
    const onSubmit = vi.fn()
    render(
      <BubbleInput
        kind="input"
        initialValue=""
        shape="soft"
        font="Comic Neue"
        enabled
        onSubmit={onSubmit}
        onDraftChange={onDraftChange}
      />,
    )
    const area = screen.getByRole('textbox', { name: 'Speech bubble text' })

    fireEvent.change(area, { target: { value: 'Hi there' } })
    fireEvent.keyDown(area, { key: 'Enter' })

    expect(onSubmit).toHaveBeenCalledWith('Hi there')
    expect(onDraftChange).toHaveBeenLastCalledWith('')
  })

  // Enter is send, so it must not open a second line on the way — in a textarea that is
  // the browser's default, and the transcript has no way to carry one.
  it('opens no second line on Enter', () => {
    const onDraftChange = vi.fn()
    render(
      <BubbleInput
        kind="input"
        initialValue=""
        shape="soft"
        font="Comic Neue"
        enabled
        onSubmit={vi.fn()}
        onDraftChange={onDraftChange}
      />,
    )
    const area = screen.getByRole('textbox', { name: 'Speech bubble text' }) as HTMLTextAreaElement

    fireEvent.change(area, { target: { value: 'Hi' } })
    const enter = fireEvent.keyDown(area, { key: 'Enter' })

    expect(enter).toBe(false) // preventDefault called
    expect(area.value).toBe('')
  })
})
