import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import BubbleKey from '../../skins/comic-book/BubbleKey'
import { CALL_KEY, HANGUP_KEY } from '../../skins/comic-book/phoneActions'

// One drawn telephone key, shared by the green key beside a dial's field and the red key
// beside the number on the line. What is its own: the artwork is the button, and every
// event stops at it rather than reaching the panel underneath.

function draw(action = HANGUP_KEY, disabled = false) {
  const onPress = vi.fn()
  const onPanel = { pointer: vi.fn(), click: vi.fn(), key: vi.fn() }
  render(
    // The panel's own React handlers, which read a press as "reveal this panel". The
    // wrapper only catches what bubbles out of the key, which is the case jsx-a11y
    // names `presentation` for.
    <div
      role="presentation"
      onPointerDown={onPanel.pointer}
      onClick={onPanel.click}
      onKeyDown={onPanel.key}
    >
      <BubbleKey action={action} disabled={disabled} onPress={onPress} />
    </div>,
  )
  return { onPress, onPanel, key: screen.getByRole('button') as HTMLButtonElement }
}

describe('a drawn telephone key', () => {
  it('is named and drawn by the key it is handed', () => {
    const { key } = draw(CALL_KEY)
    expect(key.getAttribute('aria-label')).toBe(CALL_KEY.label)
    expect(key.querySelector('img')?.getAttribute('src')).toBe(CALL_KEY.src)
    // The picture is the whole of the button, so it carries no name of its own.
    expect(key.querySelector('img')?.getAttribute('alt')).toBe('')
  })

  it('runs the press, and keeps it from the panel underneath', () => {
    const { key, onPress, onPanel } = draw()
    fireEvent.pointerDown(key)
    fireEvent.click(key)
    fireEvent.keyDown(key, { key: 'Enter' })
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onPanel.pointer).not.toHaveBeenCalled()
    expect(onPanel.click).not.toHaveBeenCalled()
    expect(onPanel.key).not.toHaveBeenCalled()
  })

  it('is out of the tab order while disabled, and presses nothing', () => {
    // Greyed rather than gone: a key vanishing off a photographed telephone reads as a
    // fault in the picture.
    const { key, onPress } = draw(HANGUP_KEY, true)
    expect(key.disabled).toBe(true)
    expect(key.tabIndex).toBe(-1)
    fireEvent.click(key)
    expect(onPress).not.toHaveBeenCalled()
  })
})
