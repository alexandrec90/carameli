import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type GroupExtension } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'description', label: 'Description' },
  { key: 'number', label: 'Number' },
  { key: 'subscribed_extensions', label: 'Subscribed Extensions' },
]

function toRow(g: GroupExtension): Record<string, string> {
  return {
    // id is not a column, so it isn't rendered; the Deactivate row action reads it back.
    id: g.id,
    description: g.description || '',
    number: g.number,
    subscribed_extensions: g.subscribed_extensions.join(', '),
  }
}

/**
 * Data hook for the Group Extension page (cloudli spec §14). Lists a customer's
 * group extensions and returns a DataPageProps so every skin renders the same
 * behaviour. Full CRUD: the create form calls Add and the per-row Deactivate
 * action calls Deactivate, both re-fetching on success.
 */
export function useGroupExtensions(): DataPageProps {
  const [groups, setGroups] = useState<GroupExtension[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading group extensions', { route: '/group-extensions' })
    setError('')
    try {
      const res = await api.groupExtensions.list(DEMO_VS_CUSTOMER_ID)
      setGroups(res.group_extensions)
    } catch (e) {
      logger.error('Failed to load group extensions', { error: String(e) })
      setError('Failed to load group extensions')
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
      const subscribedExtensions = (values.subscribed_extensions ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
      logger.info('Creating group extension', { number: values.number })
      setError('')
      try {
        await api.groupExtensions.add({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          description: values.description || '',
          number: values.number ?? '',
          subscribed_extensions: subscribedExtensions,
        })
        await load()
      } catch (e) {
        logger.error('Failed to create group extension', { error: String(e) })
        setError('Failed to create group extension')
      }
    },
    [load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating group extension', { id: row.id })
      setError('')
      try {
        await api.groupExtensions.deactivate(DEMO_VS_CUSTOMER_ID, row.id)
        await load()
      } catch (e) {
        logger.error('Failed to deactivate group extension', { error: String(e) })
        setError('Failed to deactivate group extension')
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
    a.download = 'group-extensions.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported group extensions CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Group Extension',
    description: 'Group extensions that ring a set of subscribed extensions',
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
        { key: 'description', label: 'Description', kind: 'text', placeholder: 'Sales group' },
        { key: 'number', label: 'Number', kind: 'text', placeholder: '500', required: true },
        {
          key: 'subscribed_extensions',
          label: 'Subscribed Extensions (comma-separated)',
          kind: 'text',
          placeholder: '101, 102, 103',
        },
      ],
      onSubmit: create,
    },
    emptyText: 'No group extensions configured',
  }
}
