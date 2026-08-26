import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LIVE_TABLE_FEEDS } from '../../lib/liveTables'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import TableInspector from '../../skins/comic-book/editor/TableInspector'
import { liveTable, newTable } from '../../skins/comic-book/editor/tableValidate'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'

function editorApi() {
  return { setImg: vi.fn() } as unknown as EditorModeApi
}

const CELL_PLACEHOLDER = 'Ada Lovelace | 555-0101'

describe('pointing a surface at a live feed', () => {
  it('offers the feeds the app has, plus typing the cells by hand', () => {
    const image = { ...seedConfig().images[0], table: newTable() }
    render(<TableInspector api={editorApi()} index={0} image={image} />)

    const select = screen.getByLabelText('shows') as HTMLSelectElement
    expect(select.value).toBe('')
    expect([...select.options].map(o => o.value)).toEqual(['', 'calls', 'sms'])
    expect([...select.options].map(o => o.textContent)).toContain(LIVE_TABLE_FEEDS.calls.label)
  })

  it('takes the feed\'s columns and no cells when a feed is picked', () => {
    const api = editorApi()
    const image = { ...seedConfig().images[0], table: newTable() }
    render(<TableInspector api={api} index={0} image={image} />)

    fireEvent.change(screen.getByLabelText('shows'), { target: { value: 'calls' } })
    expect(api.setImg).toHaveBeenCalledWith(0, {
      table: expect.objectContaining({
        source: 'calls',
        columns: LIVE_TABLE_FEEDS.calls.columns,
        data: [],
      }),
    })
  })

  it('keeps the corners the author already dragged onto the picture', () => {
    const api = editorApi()
    const table = { ...newTable(), rows: 11 }
    table.quad[0] = [12.5, 20]
    render(<TableInspector api={api} index={0} image={{ ...seedConfig().images[0], table }} />)

    fireEvent.change(screen.getByLabelText('shows'), { target: { value: 'sms' } })
    expect(api.setImg).toHaveBeenCalledWith(0, {
      table: expect.objectContaining({ quad: table.quad, rows: 11 }),
    })
  })

  it('comes back off a feed with cells to see rather than five empty columns', () => {
    const api = editorApi()
    const image = { ...seedConfig().images[0], table: liveTable(newTable(), 'calls') }
    render(<TableInspector api={api} index={0} image={image} />)

    fireEvent.change(screen.getByLabelText('shows'), { target: { value: '' } })
    const [, patch] = (api.setImg as ReturnType<typeof vi.fn>).mock.calls[0]
    expect('source' in patch.table).toBe(false)
    expect(patch.table.columns).toEqual(newTable().columns)
    expect(patch.table.data).toEqual(newTable().data)
  })

  it('hides the cell block for a live surface and says where the rows come from', () => {
    const image = { ...seedConfig().images[0], table: liveTable(newTable(), 'sms') }
    render(<TableInspector api={editorApi()} index={0} image={image} />)

    expect(screen.queryByPlaceholderText(CELL_PLACEHOLDER)).toBeNull()
    expect(screen.getByText(/rows come from the live sms messages/i)).toBeTruthy()
    expect(screen.getByText(/without reloading the page/i)).toBeTruthy()
  })

  // A feed's cells are positional, so removing the middle column would not remove that
  // value — it would slide every value one heading to the left.
  it('does not let the column list be added to or cut while a feed is on', () => {
    const image = { ...seedConfig().images[0], table: liveTable(newTable(), 'calls') }
    render(<TableInspector api={editorApi()} index={0} image={image} />)

    expect(screen.queryByRole('button', { name: '+ Column' })).toBeNull()
    expect(screen.queryByRole('button', { name: '−' })).toBeNull()
  })

  it('still lets the headings, widths and alignment be fitted to the picture', () => {
    const api = editorApi()
    const image = { ...seedConfig().images[0], table: liveTable(newTable(), 'calls') }
    render(<TableInspector api={api} index={0} image={image} />)

    const widths = screen.getAllByLabelText('width')
    expect(widths).toHaveLength(LIVE_TABLE_FEEDS.calls.columns.length)
    fireEvent.change(widths[0], { target: { value: '2.5' } })
    expect(api.setImg).toHaveBeenCalledWith(0, {
      table: expect.objectContaining({
        source: 'calls',
        columns: expect.arrayContaining([expect.objectContaining({ width: 2.5 })]),
      }),
    })
  })

  it('leaves the authored surface exactly as it was', () => {
    const image = { ...seedConfig().images[0], table: newTable() }
    render(<TableInspector api={editorApi()} index={0} image={image} />)

    expect(screen.getByPlaceholderText(CELL_PLACEHOLDER)).toBeTruthy()
    expect(screen.getByRole('button', { name: '+ Column' })).toBeTruthy()
  })
})
