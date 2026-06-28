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

  const load = useCallback(() => {
    logger.info('Loading API tokens', { route: '/api-tokens' })
    setError('')
    api.apiTokens.list(DEMO_VS_CUSTOMER_ID)
      .then((res) => { setTokens(res.tokens) })
      .catch((e: unknown) => {
        logger.error('Failed to load API tokens', { error: String(e) })
        setError('Failed to load API tokens')
        setTokens([])
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const rows = useMemo(() => (tokens ?? []).map(toRow), [tokens])

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
    ],
    emptyText: 'No API token found',
  }
}
