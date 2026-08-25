import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type CallQueue } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'strategy', label: 'Strategy' },
]

function toRow(q: CallQueue): Record<string, string> {
  return {
    id: q.id,
    name: q.name,
    strategy: q.strategy,
  }
}

/**
 * Data hook for the Call Queues management page (legacy feature spec §36). Config-only CRUD;
 * routing engine integration deferred.
 */
export function useCallQueues(): DataPageProps {
  const [queues, setQueues] = useState<CallQueue[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading call queues', { route: '/call-queues' })
    setError('')
    try {
      const res = await api.callQueues.list(DEMO_VS_CUSTOMER_ID)
      setQueues(res.call_queues)
    } catch (e) {
      logger.error('Failed to load call queues', { error: String(e) })
      setError('Failed to load call queues')
      setQueues([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allRows = useMemo(() => (queues ?? []).map(toRow), [queues])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allRows
    return allRows.filter((r) => Object.values(r).some((v) => v.toLowerCase().includes(q)))
  }, [allRows, search])

  const onFilterChange = useCallback((key: string, value: string) => {
    if (key === 'search') setSearch(value)
  }, [])

  const create = useCallback(
    async (values: Record<string, string>) => {
      logger.info('Creating call queue', { name: values.name })
      setError('')
      try {
        await api.callQueues.add({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          name: values.name ?? '',
          strategy: values.strategy || 'round-robin',
        })
        await load()
      } catch (e) {
        logger.error('Failed to create call queue', { error: String(e) })
        setError('Failed to create call queue')
      }
    },
    [load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating call queue', { id: row.id })
      setError('')
      try {
        await api.callQueues.deactivate(DEMO_VS_CUSTOMER_ID, row.id)
        await load()
      } catch (e) {
        logger.error('Failed to deactivate call queue', { error: String(e) })
        setError('Failed to deactivate call queue')
      }
    },
    [load],
  )

  const exportCsv = useCallback(() => {
    const header = COLUMNS.map((c) => c.label).join(',')
    const body = rows
      .map((r) => COLUMNS.map((c) => `"${(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'call-queues.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported call queues CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Call Queues',
    description: 'Call queue configurations for contact-centre routing',
    loading: queues === null,
    error,
    filters: [{ key: 'search', label: 'Search', kind: 'search', value: search }],
    onFilterChange,
    columns: COLUMNS,
    rows,
    actions: [
      { key: 'refresh', label: 'Refresh', onClick: () => void load(), variant: 'primary' },
      { key: 'export', label: 'Export CSV', onClick: exportCsv },
    ],
    rowActions: [
      {
        key: 'deactivate',
        label: 'Deactivate',
        variant: 'danger',
        onClick: (row) => void deactivate(row),
      },
    ],
    form: {
      newLabel: 'New',
      submitLabel: 'Create',
      fields: [
        { key: 'name', label: 'Name', kind: 'text', placeholder: 'Support Queue', required: true },
        {
          key: 'strategy',
          label: 'Strategy',
          kind: 'text',
          placeholder: 'round-robin',
          default: 'round-robin',
        },
      ],
      onSubmit: create,
    },
    emptyText: 'No call queues configured',
  }
}
