import { useCallback, useMemo, useState } from 'react'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

export interface PlaceholderPageConfig {
  title: string
  description: string
  route: string
  columns: DataColumn[]
  emptyText: string
}

/**
 * Shared data hook for "structural placeholder" pages — pages whose Carameli backend
 * isn't built yet, or whose data is owned by another system (VanillaSoft CRM). It renders
 * the real cloudli columns/filters/actions through DataPage but holds no rows and makes no
 * API call, so the page reaches structural parity now and a fetching hook can replace it
 * later without touching the skin layer. Search updates filter state (a no-op over the
 * empty set); Export writes the current rows to CSV.
 */
export function usePlaceholderPage(config: PlaceholderPageConfig): DataPageProps {
  const [search, setSearch] = useState('')

  const onFilterChange = useCallback((key: string, value: string) => {
    if (key === 'search') setSearch(value)
  }, [])

  const exportCsv = useCallback(() => {
    const header = config.columns.map((c) => c.label).join(',')
    const blob = new Blob([`${header}\n`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${config.route.replace(/^\//, '').replace(/\//g, '-') || 'export'}.csv`
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported placeholder CSV', { route: config.route, count: 0 })
  }, [config.columns, config.route])

  return useMemo<DataPageProps>(
    () => ({
      title: config.title,
      description: config.description,
      loading: false,
      filters: [{ key: 'search', label: 'Search', kind: 'search', value: search }],
      onFilterChange,
      columns: config.columns,
      rows: [],
      actions: [{ key: 'export', label: 'Export CSV', onClick: exportCsv }],
      emptyText: config.emptyText,
    }),
    [config, search, onFilterChange, exportCsv],
  )
}
