import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type VoicemailDropEvent } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { exportRowsCsv } from '../lib/csv'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'to_number', label: 'To Number' },
  { key: 'status', label: 'Status' },
  { key: 'call_sid', label: 'Call SID' },
  { key: 'created_at', label: 'Date' },
]

function toRow(e: VoicemailDropEvent): Record<string, string> {
  return {
    to_number: e.to_number,
    status: e.status,
    call_sid: e.call_sid ?? '—',
    created_at: e.created_at ? e.created_at.slice(0, 19).replace('T', ' ') : '',
  }
}

/**
 * Read-only list hook for voicemail drop history (legacy feature spec §18–19). Shared by
 * the Voicemail Broadcast and Mailbox Drop List pages, differentiated by title.
 */
export function useVoicemailDropEvents(title: string, description: string): DataPageProps {
  const [events, setEvents] = useState<VoicemailDropEvent[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading voicemail drop events', { route: '/mailbox-drop' })
    setError('')
    try {
      const res = await api.voicemailDropEvents.list(DEMO_VS_CUSTOMER_ID)
      setEvents(res.events)
    } catch (e) {
      logger.error('Failed to load voicemail drop events', { error: String(e) })
      setError('Failed to load voicemail drop events')
      setEvents([])
    }
  }, [])

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
  }, [])

  const exportCsv = useCallback(() => {
    exportRowsCsv(COLUMNS, rows, 'voicemail-drop-events.csv')
    logger.info('Exported voicemail drop events CSV', { count: rows.length })
  }, [rows])

  return {
    title,
    description,
    loading: events === null,
    error,
    filters: [{ key: 'search', label: 'Search', kind: 'search', value: search }],
    onFilterChange,
    columns: COLUMNS,
    rows,
    actions: [
      { key: 'refresh', label: 'Refresh', onClick: () => void load(), variant: 'primary' },
      { key: 'export', label: 'Export CSV', onClick: exportCsv },
    ],
    emptyText: 'No voicemail drop history',
  }
}
