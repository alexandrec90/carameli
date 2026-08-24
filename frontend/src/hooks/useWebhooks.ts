import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type WebhookSubscription } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'description', label: 'Description' },
  { key: 'uri', label: 'URI' },
  { key: 'events', label: 'Events' },
  { key: 'enabled', label: 'Enabled' },
]

function toRow(s: WebhookSubscription): Record<string, string> {
  return {
    // id is not a column, so it isn't rendered; the Deactivate row action reads it back.
    id: s.id,
    description: s.description || '',
    uri: s.uri,
    events: s.events.join(', '),
    enabled: s.enabled ? 'Yes' : 'No',
  }
}

/**
 * Data hook for the Webhooks management page (legacy feature spec §5). Lists a customer's
 * webhook subscriptions and returns a DataPageProps so every skin renders the same
 * behaviour. Full CRUD: the create form (DataForm) calls Add and the per-row
 * Deactivate action (DataRowAction) calls Deactivate, both re-fetching on success.
 */
export function useWebhooks(): DataPageProps {
  const [subs, setSubs] = useState<WebhookSubscription[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading webhook subscriptions', { route: '/webhooks' })
    setError('')
    try {
      const res = await api.webhooks.list(DEMO_VS_CUSTOMER_ID)
      setSubs(res.subscriptions)
    } catch (e) {
      logger.error('Failed to load webhook subscriptions', { error: String(e) })
      setError('Failed to load webhook subscriptions')
      setSubs([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allRows = useMemo(() => (subs ?? []).map(toRow), [subs])

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
      const events = (values.events ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
      logger.info('Creating webhook subscription', { uri: values.uri, events })
      setError('')
      try {
        await api.webhooks.add({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          description: values.description || '',
          uri: values.uri ?? '',
          events,
          enabled: values.enabled !== 'false',
        })
        await load()
      } catch (e) {
        logger.error('Failed to create webhook subscription', { error: String(e) })
        setError('Failed to create webhook subscription')
      }
    },
    [load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating webhook subscription', { id: row.id })
      setError('')
      try {
        await api.webhooks.deactivate(DEMO_VS_CUSTOMER_ID, row.id)
        await load()
      } catch (e) {
        logger.error('Failed to deactivate webhook subscription', { error: String(e) })
        setError('Failed to deactivate webhook subscription')
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
    a.download = 'webhooks.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported webhooks CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Webhooks',
    description: 'Webhook subscriptions delivering API events to your endpoints',
    loading: subs === null,
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
        { key: 'description', label: 'Description', kind: 'text', placeholder: 'Call ended hook' },
        {
          key: 'uri',
          label: 'URI',
          kind: 'text',
          placeholder: 'https://hooks.example.com/events',
          required: true,
        },
        { key: 'events', label: 'Events (comma-separated)', kind: 'text', placeholder: 'call.ended, call.started' },
        { key: 'enabled', label: 'Enabled', kind: 'checkbox', default: 'true' },
      ],
      onSubmit: create,
    },
    emptyText: 'No webhook subscriptions configured',
  }
}
