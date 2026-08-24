import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type CallSummaryGroupBy, type CallSummaryRow } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { formatDuration, formatPercent } from '../lib/format'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

function columnsFor(groupBy: CallSummaryGroupBy): DataColumn[] {
  return [
    { key: 'group_key', label: groupBy === 'number' ? 'Phone Number' : 'Extension' },
    { key: 'call_count', label: 'Calls' },
    { key: 'answered_count', label: 'Answered' },
    { key: 'total_duration', label: 'Total Talk Time' },
    { key: 'avg_duration', label: 'Avg Duration' },
    { key: 'success_rate', label: 'Success Rate' },
  ]
}

function toRow(r: CallSummaryRow): Record<string, string> {
  return {
    group_key: r.group_key || '(unknown)',
    call_count: String(r.call_count),
    answered_count: String(r.answered_count),
    total_duration: formatDuration(r.total_duration_seconds),
    avg_duration: formatDuration(Math.round(r.avg_duration_seconds)),
    success_rate: formatPercent(r.success_rate),
  }
}

/**
 * Data hook for the CDR Summary report page (legacy feature spec §30–34). Owns the group-by
 * dimension (extension vs phone number) and the date range, and returns a DataPageProps
 * so every skin renders it via its DataPage view. Group-by is exposed as page actions
 * (the DataPage filter contract has no select kind); date filters re-fetch server-side
 * and the search box filters loaded rows client-side.
 */
export function useCallSummary(): DataPageProps {
  const [rowsData, setRowsData] = useState<CallSummaryRow[] | null>(null)
  const [groupBy, setGroupBy] = useState<CallSummaryGroupBy>('extension')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading CDR summary', { route: '/reports', groupBy, start, end })
    setError('')
    try {
      const res = await api.calls.summary(DEMO_VS_CUSTOMER_ID, {
        groupBy,
        start: start || undefined,
        end: end || undefined,
      })
      setRowsData(res.summary)
    } catch (e) {
      logger.error('Failed to load CDR summary', { error: String(e) })
      setError('Failed to load CDR summary')
      setRowsData([])
    }
  }, [groupBy, start, end])

  useEffect(() => {
    void load()
  }, [load])

  const columns = useMemo(() => columnsFor(groupBy), [groupBy])

  const allRows = useMemo(() => (rowsData ?? []).map(toRow), [rowsData])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allRows
    return allRows.filter((r) => Object.values(r).some((v) => v.toLowerCase().includes(q)))
  }, [allRows, search])

  const onFilterChange = useCallback((key: string, value: string) => {
    if (key === 'search') setSearch(value)
    else if (key === 'start') setStart(value)
    else if (key === 'end') setEnd(value)
  }, [])

  const exportCsv = useCallback(() => {
    const header = columns.map((c) => c.label).join(',')
    const body = rows
      .map((r) => columns.map((c) => `"${(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cdr-summary-${groupBy}.csv`
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported CDR summary CSV', { count: rows.length, groupBy })
  }, [rows, columns, groupBy])

  return {
    title: 'CDR Summary',
    description: 'Call statistics grouped by extension or phone number',
    loading: rowsData === null,
    error,
    filters: [
      { key: 'search', label: 'Search', kind: 'search', value: search },
      { key: 'start', label: 'From date', kind: 'date', value: start },
      { key: 'end', label: 'To date', kind: 'date', value: end },
    ],
    onFilterChange,
    columns,
    rows,
    actions: [
      {
        key: 'by-extension',
        label: 'By Extension',
        onClick: () => setGroupBy('extension'),
        variant: groupBy === 'extension' ? 'primary' : 'default',
      },
      {
        key: 'by-number',
        label: 'By Number',
        onClick: () => setGroupBy('number'),
        variant: groupBy === 'number' ? 'primary' : 'default',
      },
      { key: 'refresh', label: 'Refresh', onClick: () => void load() },
      { key: 'export', label: 'Export CSV', onClick: exportCsv },
    ],
    emptyText: 'No call statistics for the selected range',
  }
}
