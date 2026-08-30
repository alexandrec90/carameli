import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import PageSelect from '../../skins/comic-book/editor/PageSelect'

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard' },
  { path: '/phone-lines', label: 'Phone Lines' },
]

describe('PageSelect', () => {
  it('shows saved page names and edits the current route without changing its path', () => {
    const onPageLabel = vi.fn()
    render(
      <MemoryRouter initialEntries={['/']}>
        <PageSelect
          navItems={NAV_ITEMS}
          pageLabels={{ '/': 'Front Desk' }}
          previewingLoading={false}
          onPreviewLoading={vi.fn()}
          onPageLabel={onPageLabel}
        />
      </MemoryRouter>,
    )

    const pages = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Page' })
    expect([...pages.options].map(option => option.text)).toContain('Front Desk')
    expect([...pages.options].map(option => option.text)).toContain('Phone Lines')

    fireEvent.change(screen.getByRole('textbox', { name: 'page name' }), {
      target: { value: 'Mission Control' },
    })
    expect(onPageLabel).toHaveBeenCalledWith('/', 'Mission Control')
  })
})
