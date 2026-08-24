import { DEFAULT_QUAD, QUAD_RANGE } from '../tableProjection'
import type { Quad } from '../tableProjection'
import { fitColumns, FONT_SCALE, ROW_COUNT } from '../tableData'
import type { TableColumn, TableProjection } from './types'

// Reading a projected table back out of a persisted working copy. Everything here is
// repair rather than rejection: a table is a lot of authored content — corners dragged
// onto a photograph, columns, every cell — and throwing the whole surface away because
// one number came back as a string loses all of it. The one thing that *is* rejected is
// a quad that is not four points, because there is no sensible corner to invent.

const ALIGNS = ['left', 'center', 'right'] as const

/** A brand-new surface, with enough in it to be visible the moment it is switched on. */
export function newTable(): TableProjection {
  return {
    quad: DEFAULT_QUAD.map(([x, y]) => [x, y]) as Quad,
    rows: 8,
    header: true,
    columns: [
      { label: 'Name', width: 2, align: 'left' },
      { label: 'Number', width: 1, align: 'right' },
    ],
    data: [
      ['Ada Lovelace', '555-0101'],
      ['Grace Hopper', '555-0102'],
      ['Alan Turing', '555-0103'],
      ['Katherine Johnson', '555-0104'],
      ['Margaret Hamilton', '555-0105'],
      ['Claude Shannon', '555-0106'],
      ['Hedy Lamarr', '555-0107'],
      ['Vint Cerf', '555-0108'],
    ],
    fontScale: 0.5,
    // Ballpoint blue: the lettering has to read as written *on* the surface, and pure
    // black reads as printed over it.
    ink: '#1b3a8f',
  }
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

/** Four `[x, y]` pairs, clamped to the draggable range, or null if it isn't four. */
export function coerceQuad(v: unknown): Quad | null {
  if (!Array.isArray(v) || v.length !== 4) return null
  const pts = v.map(p =>
    Array.isArray(p) && p.length >= 2
      ? ([num(p[0], 0, QUAD_RANGE.min, QUAD_RANGE.max), num(p[1], 0, QUAD_RANGE.min, QUAD_RANGE.max)] as [number, number])
      : null,
  )
  return pts.every(p => p !== null) ? (pts as Quad) : null
}

function coerceColumn(v: unknown): TableColumn {
  const c = (v ?? {}) as Partial<TableColumn>
  const align = ALIGNS.includes(c.align as TableColumn['align']) ? (c.align as TableColumn['align']) : 'left'
  return { label: str(c.label, ''), width: num(c.width, 1, 0.1, 100), align }
}

function coerceData(v: unknown, colCount: number): string[][] {
  if (!Array.isArray(v)) return []
  const rows = v.map(row => (Array.isArray(row) ? row.map(cell => str(cell, String(cell ?? ''))) : []))
  return fitColumns(rows, colCount)
}

/**
 * A persisted value as a usable {@link TableProjection}, or undefined when the picture is
 * not a surface at all (absent, null, or a quad that is not four corners).
 *
 * Undefined rather than null because absence is how "not a surface" is spelled all the
 * way through — see the `table` field on ImgTransform, and the save round trip that
 * depends on it.
 *
 * Called from `hydrateConfig` for every picture, so it also has to be cheap and total for
 * the overwhelmingly common case of "this picture has no table".
 */
export function coerceTable(v: unknown): TableProjection | undefined {
  if (v == null || typeof v !== 'object') return undefined
  const t = v as Partial<TableProjection>
  const quad = coerceQuad(t.quad)
  if (!quad) return undefined
  const columns = Array.isArray(t.columns) && t.columns.length > 0 ? t.columns.map(coerceColumn) : newTable().columns
  return {
    quad,
    rows: Math.round(num(t.rows, 8, ROW_COUNT.min, ROW_COUNT.max)),
    header: t.header !== false,
    columns,
    data: coerceData(t.data, columns.length),
    fontScale: num(t.fontScale, 0.5, FONT_SCALE.min, FONT_SCALE.max),
    ink: str(t.ink, '#1b3a8f'),
  }
}

/** Deep copy of a table, so a working copy never shares a cell with the seed. */
export function cloneTable(t: TableProjection): TableProjection {
  return {
    ...t,
    quad: t.quad.map(([x, y]) => [x, y]) as Quad,
    columns: t.columns.map(c => ({ ...c })),
    data: t.data.map(row => [...row]),
  }
}
