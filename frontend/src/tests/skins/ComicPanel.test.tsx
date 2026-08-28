import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import ComicPanel from '../../skins/comic-book/ComicPanel'
import { idleSms } from './smsStub'

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>
}

function drawPanel(hovered: boolean) {
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
        hovered={hovered}
        isRevealed={() => false}
        isBubbleVisible={() => false}
        dotRef={() => undefined}
        onSettled={() => undefined}
        onNatSize={() => undefined}
      />
      <CurrentPath />
    </MemoryRouter>,
  )
  return container.querySelector('.cb-panel') as HTMLDivElement
}

describe('ComicPanel', () => {
  it('is not a navigation control and owns no hover handlers', () => {
    const panel = drawPanel(false)

    expect(panel.getAttribute('role')).toBeNull()
    expect(panel.getAttribute('tabindex')).toBeNull()
    expect(panel.classList.contains('clickable')).toBe(false)

    // Hover is decided by Layout's geometric hit test (usePanelHover), never by
    // this element: its box is the polygon's bounding rectangle, and neighbouring
    // rectangles overlap wherever a seam slants. Entering the element is inert.
    fireEvent.mouseEnter(panel)
    expect(panel.classList.contains('cb-panel-lift')).toBe(false)
    expect(panel.classList.contains('cb-panel-hot')).toBe(false)

    fireEvent.click(panel)
    expect(screen.getByTestId('current-path').textContent).toBe('/')
  })

  it('lights and lifts from the hovered prop, and is addressable by index', () => {
    const panel = drawPanel(true)

    // cb-panel-hot is what colorizes the dots and pictures (comic-book.css keys
    // them off this class, not :hover — the stylesheet's :hover answered for the
    // bounding rectangle, so a neighbour could light under another panel's spill).
    expect(panel.classList.contains('cb-panel-hot')).toBe(true)
    expect(panel.classList.contains('cb-panel-lift')).toBe(true)
    // The index in the DOM is what lets usePanelHover measure this panel's drawn
    // balloons — a chain's rows stand where no transform says they do.
    expect(panel.getAttribute('data-cb-panel')).toBe('1')
  })
})
