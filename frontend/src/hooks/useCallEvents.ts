import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type CallEvent } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { formatDateTime, formatDuration } from '../lib/format'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'started_at', label: 'Date' },
  { key: 'direction', label: 'Direction' },
  { key: 'from_number', label: 'From' },
  { key: 'to_number', label: 'To' },
  { key: 'duration', label: 'Duration' },
  { key: 'status', label: 'Status' },
  { key: 'recording', label: 'Recording' },
]

function toRow(e: CallEvent): Record<string, string> {
  return {
    started_at: formatDateTime(e.started_at),
    direction: e.direction ?? '',
    from_number: e.from_number ?? '',
    to_number: e.to_number ?? '',
    duration: formatDuration(e.duration_seconds),
    status: e.status ?? '',
    recording: e.recording_url ? 'Yes' : '',
  }
}

/**
 * Data hook for the Call Events page. Owns filter state + fetching and returns a
 * DataPageProps descriptor, so the page is a thin orchestrator and every skin
 * renders the same behaviour via its DataPage view. Date filters are applied
 * server-side (re-fetch); the search box filters the loaded rows client-side.
 */
export function useCallEvents(): DataPageProps {
  const [events, setEvents] = useState<CallEvent[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading call events', { route: '/calls', start, end })
    setError('')
    try {
      const res = await api.calls.list(DEMO_VS_CUSTOMER_ID, {
        start: start || undefined,
        end: end || undefined,
        limit: 200,
      })
      setEvents(res.events)
    } catch (e) {
      logger.error('Failed to load call events', { error: String(e) })
      setError('Failed to load call events')
      setEvents([])
    }
  }, [start, end])

  useEffect(() => {
    void load()
  }, [load])

  const allRows = useMemo(() => (events ?? []).map(toRow), [events])

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
    const header = COLUMNS.map((c) => c.label).join(',')
    const body = rows
      .map((r) => COLUMNS.map((c) => `"${(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'call-events.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported call events CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Call Events',
    description: 'Real-time call tracking and status history',
    loading: events === null,
    error,
    filters: [
      { key: 'search', label: 'Search', kind: 'search', value: search },
      { key: 'start', label: 'From date', kind: 'date', value: start },
      { key: 'end', label: 'To date', kind: 'date', value: end },
    ],
    onFilterChange,
    columns: COLUMNS,
    rows,
    actions: [
      { key: 'refresh', label: 'Refresh', onClick: () => void load(), variant: 'primary' },
      { key: 'export', label: 'Export CSV', onClick: exportCsv },
    ],
    emptyText: 'No call events for the selected range',
  }
}
