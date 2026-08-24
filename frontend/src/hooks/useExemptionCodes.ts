import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type ExemptionCode } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'description', label: 'Description' },
  { key: 'code', label: 'Exemption Code' },
  { key: 'call_restrictions', label: 'Call Restrictions' },
]

function toRow(ec: ExemptionCode): Record<string, string> {
  return {
    id: ec.id,
    description: ec.description,
    code: ec.code,
    call_restrictions: ec.call_restrictions,
  }
}

/**
 * Data hook for the Exemption Codes page (legacy feature spec §11). Full CRUD —
 * create form + per-row Deactivate.
 */
export function useExemptionCodes(): DataPageProps {
  const [codes, setCodes] = useState<ExemptionCode[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading exemption codes', { route: '/exemption-codes' })
    setError('')
    try {
      const res = await api.exemptionCodes.list(DEMO_VS_CUSTOMER_ID)
      setCodes(res.exemption_codes)
    } catch (e) {
      logger.error('Failed to load exemption codes', { error: String(e) })
      setError('Failed to load exemption codes')
      setCodes([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allRows = useMemo(() => (codes ?? []).map(toRow), [codes])

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
      logger.info('Creating exemption code', { code: values.code })
      setError('')
      try {
        await api.exemptionCodes.add({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          description: values.description ?? '',
          code: values.code ?? '',
          call_restrictions: values.call_restrictions ?? '',
        })
        await load()
      } catch (e) {
        logger.error('Failed to create exemption code', { error: String(e) })
        setError('Failed to create exemption code')
      }
    },
    [load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating exemption code', { id: row.id })
      setError('')
      try {
        await api.exemptionCodes.deactivate(DEMO_VS_CUSTOMER_ID, row.id)
        await load()
      } catch (e) {
        logger.error('Failed to deactivate exemption code', { error: String(e) })
        setError('Failed to deactivate exemption code')
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
    a.download = 'exemption-codes.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported exemption codes CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Exemption Codes',
    description: 'Codes that bypass call restrictions at the account or extension level',
    loading: codes === null,
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
        {
          key: 'description',
          label: 'Description',
          kind: 'text',
          placeholder: 'Long distance override',
          required: true,
        },
        {
          key: 'code',
          label: 'Exemption Code',
          kind: 'text',
          placeholder: 'EXEMPT01',
          required: true,
        },
        {
          key: 'call_restrictions',
          label: 'Call Restrictions',
          kind: 'text',
          placeholder: 'international, long-distance',
        },
      ],
      onSubmit: create,
    },
    emptyText: 'No exemption codes configured',
  }
}
