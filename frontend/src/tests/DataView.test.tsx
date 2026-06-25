import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataView } from '../components/DataView'
import type { DataPageProps } from '../lib/dataPage'

function baseProps(over: Partial<DataPageProps> = {}): DataPageProps {
  return {
    title: 'Webhooks',
    loading: false,
    filters: [],
    onFilterChange: vi.fn(),
    columns: [{ key: 'uri', label: 'URI' }],
    rows: [{ id: 'sub-1', uri: 'https://hooks.example.com/x' }],
    actions: [],
    ...over,
  }
}

describe('DataView contract extensions', () => {
  it('renders a per-row action button and passes the full row to its handler', () => {
    const onClick = vi.fn()
    render(
      <DataView
        {...baseProps({
          rowActions: [{ key: 'deactivate', label: 'Deactivate', variant: 'danger', onClick }],
        })}
      />,
    )
    // The Actions column header and the row button both render.
    expect(screen.getByText('Actions')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    expect(onClick).toHaveBeenCalledWith({ id: 'sub-1', uri: 'https://hooks.example.com/x' })
  })

  it('toggles the create form, applies field defaults, and submits collected values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <DataView
        {...baseProps({
          form: {
            newLabel: 'New',
            submitLabel: 'Create',
            fields: [
              { key: 'uri', label: 'URI', kind: 'text', required: true },
              { key: 'enabled', label: 'Enabled', kind: 'checkbox', default: 'true' },
            ],
            onSubmit,
          },
        })}
      />,
    )

    // Form is hidden until New is pressed.
    expect(screen.queryByLabelText('URI')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))

    const uriInput = screen.getByLabelText('URI') as HTMLInputElement
    fireEvent.change(uriInput, { target: { value: 'https://hooks.example.com/y' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        uri: 'https://hooks.example.com/y',
        enabled: 'true', // default applied without touching the checkbox
      }),
    )
  })

  it('omits the Actions column when no rowActions are supplied', () => {
    render(<DataView {...baseProps()} />)
    expect(screen.queryByText('Actions')).toBeNull()
  })
})
