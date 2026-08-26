import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BubbleInput from '../../skins/comic-book/BubbleInput'

afterEach(() => vi.restoreAllMocks())

describe('BubbleInput', () => {
  it('renders an enabled, editable plain-text field without changing punctuation', () => {
    render(<BubbleInput kind="input" initialValue="Your name" font="Comic Neue" enabled />)
    const input = screen.getByRole('textbox', { name: 'Speech bubble text' }) as HTMLInputElement

    fireEvent.change(input, { target: { value: 'A. Person' } })

    expect(input.value).toBe('A. Person')
    expect(input.disabled).toBe(false)
    expect(input.tabIndex).toBe(0)
  })

  it('formats a phone number live and exposes phone keyboard semantics', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
    render(<BubbleInput kind="phone" initialValue="" font="Comic Neue" enabled />)
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
    render(<BubbleInput kind="input" initialValue="Draft" font="Comic Neue" enabled={false} />)
    const input = screen.getByRole('textbox', { name: 'Speech bubble text' }) as HTMLInputElement

    expect(input.disabled).toBe(true)
    expect(input.tabIndex).toBe(-1)
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
    render(<BubbleInput kind="input" initialValue="" font="Comic Neue" enabled />)
    const input = screen.getByRole('textbox', { name: 'Speech bubble text' }) as HTMLInputElement

    fireEvent.change(input, { target: { value: 'Draft' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input.value).toBe('Draft')
  })
})
