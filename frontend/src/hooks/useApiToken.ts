import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type ApiTokenRow } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'token_masked', label: 'Token' },
  { key: 'enabled', label: 'Enabled' },
]

function toRow(t: ApiTokenRow): Record<string, string> {
  return {
    token_masked: t.token_masked,
    enabled: t.enabled ? 'Yes' : 'No',
  }
}

/**
 * Data hook for the API Token page (cloudli spec §4). Read-only view of the
 * customer's masked API key — no create form, no row actions.
 */
export function useApiToken(): DataPageProps {
  const [tokens, setTokens] = useState<ApiTokenRow[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading API tokens', { route: '/api-tokens' })
    setError('')
    try {
      const res = await api.apiTokens.list(DEMO_VS_CUSTOMER_ID)
      setTokens(res.tokens)
    } catch (e) {
      logger.error('Failed to load API tokens', { error: String(e) })
      setError('Failed to load API tokens')
      setTokens([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => (tokens ?? []).map(toRow), [tokens])

  const exportCsv = useCallback(() => {
    const header = COLUMNS.map((c) => c.label).join(',')
    const body = rows
      .map((r) => COLUMNS.map((c) => `"${(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'api-tokens.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported API tokens CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'API Token',
    description: 'Read-only view of your account API key',
    loading: tokens === null,
    error,
    filters: [],
    onFilterChange: () => undefined,
    columns: COLUMNS,
    rows,
    actions: [
      { key: 'refresh', label: 'Refresh', onClick: () => void load(), variant: 'primary' },
      { key: 'export', label: 'Export CSV', onClick: exportCsv },
    ],
    emptyText: 'No API token found',
  }
}
