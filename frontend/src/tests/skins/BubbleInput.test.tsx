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
