import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import { fitTableToPicture } from '../../skins/comic-book/editor/fitRuledLines'
import TableInspector from '../../skins/comic-book/editor/TableInspector'
import { newTable, withRows } from '../../skins/comic-book/editor/tableValidate'
import type { ImgTransform, TableProjection } from '../../skins/comic-book/editor/types'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'

// The button that lines the table up. The fit itself is `ruledLines.test.ts`; this is
// what the inspector does with its answer — writes it into the surface, says so, and
// says why when there is none — and the one edit that has to undo it: retyping the rows.

vi.mock('../../skins/comic-book/editor/fitRuledLines', () => ({
  fitTableToPicture: vi.fn(),
}))

const fit = vi.mocked(fitTableToPicture)

const FITTED = {
  quad: [[10, 5], [90, 5], [90, 60], [10, 60]] as TableProjection['quad'],
  rows: 4,
  lines: [0, 0.24, 0.5, 0.76, 1],
}

function setup(table: TableProjection = newTable()) {
  const image: ImgTransform = { ...seedConfig().images[0]!, table }
  const api = {
    setImg: vi.fn(),
    config: { ...seedConfig(), images: [image] },
  } as unknown as EditorModeApi
  render(<TableInspector api={api} index={0} image={image} />)
  return { api, image }
}

beforeEach(() => {
  fit.mockReset()
})

describe('Fit to ruled lines', () => {
  it('writes the fitted corners, band count and line feet into the surface', async () => {
    fit.mockResolvedValue({ ok: true, fit: FITTED })
    const { api, image } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Fit to ruled lines' }))
    expect(fit).toHaveBeenCalledWith(image.src)
    await screen.findByText('Fitted 4 bands to the lines drawn in the picture.')

    expect(api.setImg).toHaveBeenCalledWith(0, {
      table: expect.objectContaining({
        quad: FITTED.quad,
        rows: 4,
        lines: FITTED.lines,
        columns: newTable().columns,
      }),
    })
  })

  it('says why when the picture has no ruling, and changes nothing', async () => {
    fit.mockResolvedValue({ ok: false, reason: 'No ruled lines found.' })
    const { api } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Fit to ruled lines' }))
    await screen.findByText('No ruled lines found.')
    expect(screen.getByRole('status').textContent).toBe('No ruled lines found.')
    expect(api.setImg).not.toHaveBeenCalled()
  })

  it('says it is reading the picture while the fit is in flight', () => {
    fit.mockReturnValue(new Promise(() => {}))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Fit to ruled lines' }))
    expect(screen.getByRole('status').textContent).toMatch(/Reading the picture/)
  })

  /*
   * A fitted ruling is measured for a row count, so typing a different count over it has
   * to take the ruling with it: a list the renderer ignores today comes back the moment
   * the old count is typed again, on lines the corners may since have moved off.
   */
  it('drops the fitted lines when the row count is retyped', () => {
    const { api } = setup({ ...newTable(), rows: 4, lines: FITTED.lines })
    fireEvent.change(screen.getByLabelText('rows'), { target: { value: '6' } })
    const written = (api.setImg as ReturnType<typeof vi.fn>).mock.calls[0]![1].table as TableProjection
    expect(written.rows).toBe(6)
    expect('lines' in written).toBe(false)
  })
})

describe('withRows', () => {
  it('retypes the count and removes the key rather than leaving it undefined', () => {
    const next = withRows({ ...newTable(), lines: [0, 0.5, 1], rows: 2 }, 3)
    expect(next.rows).toBe(3)
    expect('lines' in next).toBe(false)
  })

  it('leaves a surface with no ruling as it was, at the new count', () => {
    const next = withRows(newTable(), 12)
    expect(next).toEqual({ ...newTable(), rows: 12 })
  })
})
