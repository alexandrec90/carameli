import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import ComicPanel from '../../skins/comic-book/ComicPanel'
import { idleSms } from './smsStub'

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>
}

describe('ComicPanel', () => {
  it('keeps hover behavior without acting as a navigation control', () => {
    const onHover = vi.fn()
    const formerlyLinkedPanel = {
      label: 'Switchboard',
      isLogo: false,
      path: '/phone-lines',
      page: 'classic' as const,
    }
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <ComicPanel
          index={1}
          info={formerlyLinkedPanel}
          poly={{
            vp: [[0, 0], [100, 0], [100, 100], [0, 100]],
            bounds: { x: 0, y: 0, w: 100, h: 100 },
          }}
          images={[]}
          bubbles={[]}
          chains={[]}
          sms={idleSms()}
          natSizes={{}}
          editorActive={false}
          hovered={false}
          onHover={onHover}
          isRevealed={() => false}
          isBubbleVisible={() => false}
          dotRef={() => undefined}
          onSettled={() => undefined}
          onNatSize={() => undefined}
        />
        <CurrentPath />
      </MemoryRouter>,
    )
    const panel = container.querySelector('.cb-panel') as HTMLDivElement

    expect(panel.getAttribute('role')).toBeNull()
    expect(panel.getAttribute('tabindex')).toBeNull()
    expect(panel.classList.contains('clickable')).toBe(false)

    fireEvent.mouseEnter(panel)
    fireEvent.mouseLeave(panel)
    expect(onHover.mock.calls).toEqual([[true], [false]])

    fireEvent.click(panel)
    expect(screen.getByTestId('current-path').textContent).toBe('/')
  })
})
