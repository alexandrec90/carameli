import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import StaleNotice from '../../skins/comic-book/editor/StaleNotice'
import type { ConfigDrift } from '../../skins/comic-book/editor/configDrift'

// The block above Save when the file has moved. What it *knows* is ./configDrift.ts and is
// tested in editorConfigDrift.test.ts; this is about the offer it makes, because the offer
// is the part that failed before it existed: three sentences of prose ending in "Reset
// discards the work in this tab" is a warning nobody acts on, and the call layout stayed
// lost until somebody merged the file by hand.

const drift: ConfigDrift = {
  panels: [
    { panel: 8, label: 'Phone', changes: ['became a phone call', '3 pictures added'] },
    { panel: 11, label: 'Pensive girl', changes: ['1 picture changed'] },
  ],
  page: ['the panel shapes moved'],
}

const empty: ConfigDrift = { panels: [], page: [] }

describe('StaleNotice', () => {
  it('says nothing when the copy is neither behind nor untracked', () => {
    const { container } = render(
      <StaleNotice stale={false} drift={empty} untracked={false} onAdopt={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('lists each drifted panel with the button that takes it', () => {
    const onAdopt = vi.fn()
    render(<StaleNotice stale drift={drift} untracked={false} onAdopt={onAdopt} />)

    expect(screen.getByText(/Phone — became a phone call, 3 pictures added/)).toBeTruthy()
    expect(screen.getByText(/Pensive girl — 1 picture changed/)).toBeTruthy()

    const takes = screen.getAllByRole('button', { name: 'Take' })
    expect(takes).toHaveLength(2)
    fireEvent.click(takes[0])
    expect(onAdopt).toHaveBeenCalledWith(8)
  })

  // A grid belongs to the whole page, so there is nothing to take one panel at a time —
  // and a row with a dead button beside it would say the opposite.
  it('shows a page-level change with no button', () => {
    render(<StaleNotice stale drift={drift} untracked={false} onAdopt={vi.fn()} />)

    expect(screen.getByText('the panel shapes moved')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Take' })).toHaveLength(2)
  })

  // The remedy differs, so the wording does: a copy nobody can diff is not told to take a
  // panel it has no way to name.
  it('tells an untracked copy how to start being tracked instead', () => {
    render(<StaleNotice stale={false} drift={null} untracked onAdopt={vi.fn()} />)

    expect(screen.getByText(/does not say which layoutConfig.ts it came from/)).toBeTruthy()
    expect(screen.getByText(/press Reset once/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Take' })).toBeNull()
  })

  it('keeps the stale headline when a stale copy is also untracked', () => {
    render(<StaleNotice stale drift={null} untracked onAdopt={vi.fn()} />)
    expect(screen.getByText(/layoutConfig.ts has changed/)).toBeTruthy()
  })
})
