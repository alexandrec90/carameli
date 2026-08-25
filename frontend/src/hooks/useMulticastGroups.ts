import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type MulticastGroup } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'extension', label: 'Extension' },
  { key: 'description', label: 'Description' },
  { key: 'extensions', label: 'Extensions' },
  { key: 'users', label: 'Users' },
]

function toRow(g: MulticastGroup): Record<string, string> {
  return {
    // id is not a column, so it isn't rendered; the Deactivate row action reads it back.
    id: g.id,
    extension: g.extension,
    description: g.description || '',
    extensions: g.extensions.join(', '),
    users: g.users.join(', '),
  }
}

/**
 * Data hook for the Multi-cast Intercom page (legacy feature spec §16). Lists a customer's
 * multi-cast intercom extensions and returns a DataPageProps so every skin renders
 * the same behaviour. Full CRUD: the create form calls Add and the per-row
 * Deactivate action calls Deactivate, both re-fetching on success.
 */
export function useMulticastGroups(): DataPageProps {
  const [groups, setGroups] = useState<MulticastGroup[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading multicast groups', { route: '/multicast-intercom' })
    setError('')
    try {
      const res = await api.multicastGroups.list(DEMO_VS_CUSTOMER_ID)
      setGroups(res.multicast_groups)
    } catch (e) {
      logger.error('Failed to load multicast groups', { error: String(e) })
      setError('Failed to load multicast groups')
      setGroups([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allRows = useMemo(() => (groups ?? []).map(toRow), [groups])

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
      const extensions = (values.extensions ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
      const users = (values.users ?? '')
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean)
      logger.info('Creating multicast group', { extension: values.extension })
      setError('')
      try {
        await api.multicastGroups.add({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          extension: values.extension ?? '',
          description: values.description || '',
          extensions,
          users,
        })
        await load()
      } catch (e) {
        logger.error('Failed to create multicast group', { error: String(e) })
        setError('Failed to create multicast group')
      }
    },
    [load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating multicast group', { id: row.id })
      setError('')
      try {
        await api.multicastGroups.deactivate(DEMO_VS_CUSTOMER_ID, row.id)
        await load()
      } catch (e) {
        logger.error('Failed to deactivate multicast group', { error: String(e) })
        setError('Failed to deactivate multicast group')
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
    a.download = 'multicast-intercom.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported multicast groups CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Intercom Extension - Multi-cast',
    description: 'Broadcast from a single source to a group of subscriber extensions',
    loading: groups === null,
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
        { key: 'extension', label: 'Extension', kind: 'text', placeholder: '700', required: true },
        { key: 'description', label: 'Description', kind: 'text', placeholder: 'Warehouse paging' },
        {
          key: 'extensions',
          label: 'Extensions (comma-separated)',
          kind: 'text',
          placeholder: '101, 102, 103',
        },
        { key: 'users', label: 'Users (comma-separated)', kind: 'text', placeholder: 'alice, bob' },
      ],
      onSubmit: create,
    },
    emptyText: 'No multi-cast intercom extensions configured',
  }
}
