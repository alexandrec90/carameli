import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Agent } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'extension_id', label: 'Extension ID' },
]

function toRow(a: Agent): Record<string, string> {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    extension_id: a.extension_id ?? '',
  }
}

/**
 * Data hook for the Agents management page (cloudli spec §35). Lists a customer's
 * configured agents and returns a DataPageProps for full CRUD via DataPage.
 */
export function useAgents(): DataPageProps {
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading agents', { route: '/agents' })
    setError('')
    try {
      const res = await api.agents.list(DEMO_VS_CUSTOMER_ID)
      setAgents(res.agents)
    } catch (e) {
      logger.error('Failed to load agents', { error: String(e) })
      setError('Failed to load agents')
      setAgents([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allRows = useMemo(() => (agents ?? []).map(toRow), [agents])

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
      logger.info('Creating agent', { name: values.name })
      setError('')
      try {
        await api.agents.add({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          name: values.name ?? '',
          extension_id: values.extension_id || null,
          status: values.status || 'available',
        })
        await load()
      } catch (e) {
        logger.error('Failed to create agent', { error: String(e) })
        setError('Failed to create agent')
      }
    },
    [load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating agent', { id: row.id })
      setError('')
      try {
        await api.agents.deactivate(DEMO_VS_CUSTOMER_ID, row.id)
        await load()
      } catch (e) {
        logger.error('Failed to deactivate agent', { error: String(e) })
        setError('Failed to deactivate agent')
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
    a.download = 'agents.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported agents CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Agents',
    description: 'Contact-centre agents and their extension assignments',
    loading: agents === null,
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
        { key: 'name', label: 'Name', kind: 'text', placeholder: 'Alice Smith', required: true },
        { key: 'extension_id', label: 'Extension ID (UUID)', kind: 'text', placeholder: 'optional' },
        { key: 'status', label: 'Status', kind: 'text', placeholder: 'available', default: 'available' },
      ],
      onSubmit: create,
    },
    emptyText: 'No agents configured',
  }
}
