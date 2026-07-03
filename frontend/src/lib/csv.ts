import type { DataColumn } from './dataPage'

/**
 * Build a CSV from `columns`/`rows` and trigger a browser download. Shared by data
 * hooks' "Export CSV" actions so the Blob/anchor-click boilerplate isn't redefined
 * per hook (see frontend-style rule).
 */
export function exportRowsCsv(
  columns: DataColumn[],
  rows: Array<Record<string, string>>,
  filename: string,
): void {
  const header = columns.map((c) => c.label).join(',')
  const body = rows
    .map((r) => columns.map((c) => `"${(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
