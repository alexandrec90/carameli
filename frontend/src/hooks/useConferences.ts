import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Conference } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'number', label: 'Number' },
  { key: 'description', label: 'Description' },
  { key: 'max_participants', label: 'Maximum Participants' },
  { key: 'recorded_calls', label: 'Recorded Calls' },
]

function toRow(c: Conference): Record<string, string> {
  return {
    // id is not a column, so it isn't rendered; the Deactivate row action reads it back.
    id: c.id,
    number: c.number,
    description: c.description || '',
    max_participants: String(c.max_participants),
    recorded_calls: c.recorded_calls ? 'Yes' : 'No',
  }
}

/**
 * Data hook for the Telephone Conferences page (cloudli spec §24). Lists a
 * customer's permanent conferences and returns a DataPageProps so every skin
 * renders the same behaviour. Full CRUD: the create form calls Add and the
 * per-row Deactivate action calls Deactivate, both re-fetching on success.
 */
export function useConferences(): DataPageProps {
  const [conferences, setConferences] = useState<Conference[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading conferences', { route: '/conferences' })
    setError('')
    try {
      const res = await api.conferences.list(DEMO_VS_CUSTOMER_ID)
      setConferences(res.conferences)
    } catch (e) {
      logger.error('Failed to load conferences', { error: String(e) })
      setError('Failed to load conferences')
      setConferences([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allRows = useMemo(() => (conferences ?? []).map(toRow), [conferences])

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
      const maxParticipants = Number(values.max_participants)
      logger.info('Creating conference', { number: values.number })
      setError('')
      try {
        await api.conferences.add({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          number: values.number ?? '',
          description: values.description || '',
          max_participants:
            Number.isFinite(maxParticipants) && maxParticipants > 0 ? maxParticipants : undefined,
          recorded_calls: values.recorded_calls === 'true',
        })
        await load()
      } catch (e) {
        logger.error('Failed to create conference', { error: String(e) })
        setError('Failed to create conference')
      }
    },
    [load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating conference', { id: row.id })
      setError('')
      try {
        await api.conferences.deactivate(DEMO_VS_CUSTOMER_ID, row.id)
        await load()
      } catch (e) {
        logger.error('Failed to deactivate conference', { error: String(e) })
        setError('Failed to deactivate conference')
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
    a.download = 'conferences.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported conferences CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Telephone Conferences',
    description: 'Management of permanent telephone conferences',
    loading: conferences === null,
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
        { key: 'number', label: 'Number', kind: 'text', placeholder: '700', required: true },
        { key: 'description', label: 'Description', kind: 'text', placeholder: 'Weekly all-hands' },
        {
          key: 'max_participants',
          label: 'Maximum Participants',
          kind: 'text',
          placeholder: '10',
        },
        { key: 'recorded_calls', label: 'Recorded Calls', kind: 'checkbox', default: 'false' },
      ],
      onSubmit: create,
    },
    emptyText: 'No telephone conferences configured',
  }
}
