import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type IntercomGroup } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'number', label: 'Number' },
  { key: 'description', label: 'Description' },
  { key: 'subscriber_extensions', label: 'Subscriber Extensions' },
  { key: 'bidirectional_audio', label: 'Bidirectional Audio' },
  { key: 'expiry', label: 'Expiry' },
]

function toRow(g: IntercomGroup): Record<string, string> {
  return {
    // id is not a column, so it isn't rendered; the Deactivate row action reads it back.
    id: g.id,
    number: g.number,
    description: g.description || '',
    subscriber_extensions: g.subscriber_extensions.join(', '),
    bidirectional_audio: g.bidirectional_audio ? 'Yes' : 'No',
    expiry: g.expiry || '',
  }
}

/**
 * Data hook for the Intercom Extension page (legacy feature spec §15). Lists a customer's
 * intercom extensions and returns a DataPageProps so every skin renders the same
 * behaviour. Full CRUD: the create form calls Add and the per-row Deactivate
 * action calls Deactivate, both re-fetching on success.
 */
export function useIntercomGroups(): DataPageProps {
  const [groups, setGroups] = useState<IntercomGroup[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading intercom groups', { route: '/intercom' })
    setError('')
    try {
      const res = await api.intercomGroups.list(DEMO_VS_CUSTOMER_ID)
      setGroups(res.intercom_groups)
    } catch (e) {
      logger.error('Failed to load intercom groups', { error: String(e) })
      setError('Failed to load intercom groups')
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
      const subscriberExtensions = (values.subscriber_extensions ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
      logger.info('Creating intercom group', { number: values.number })
      setError('')
      try {
        await api.intercomGroups.add({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          number: values.number ?? '',
          description: values.description || '',
          subscriber_extensions: subscriberExtensions,
          bidirectional_audio: values.bidirectional_audio !== 'false',
          expiry: values.expiry || null,
        })
        await load()
      } catch (e) {
        logger.error('Failed to create intercom group', { error: String(e) })
        setError('Failed to create intercom group')
      }
    },
    [load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating intercom group', { id: row.id })
      setError('')
      try {
        await api.intercomGroups.deactivate(DEMO_VS_CUSTOMER_ID, row.id)
        await load()
      } catch (e) {
        logger.error('Failed to deactivate intercom group', { error: String(e) })
        setError('Failed to deactivate intercom group')
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
    a.download = 'intercom.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported intercom groups CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Intercom Extension',
    description: 'Subscriber extensions receive calls on the speaker of their device',
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
        { key: 'number', label: 'Number', kind: 'text', placeholder: '600', required: true },
        { key: 'description', label: 'Description', kind: 'text', placeholder: 'Floor 1 intercom' },
        {
          key: 'subscriber_extensions',
          label: 'Subscriber Extensions (comma-separated)',
          kind: 'text',
          placeholder: '101, 102, 103',
        },
        { key: 'bidirectional_audio', label: 'Bidirectional Audio', kind: 'checkbox', default: 'false' },
        { key: 'expiry', label: 'Expiry', kind: 'text', placeholder: '2026-12-31' },
      ],
      onSubmit: create,
    },
    emptyText: 'No intercom extensions configured',
  }
}
