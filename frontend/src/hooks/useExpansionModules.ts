import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type ExpansionModule } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'description', label: 'Description' },
  { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' },
]

function toRow(em: ExpansionModule): Record<string, string> {
  return {
    id: em.id,
    description: em.description,
    brand: em.brand,
    model: em.model,
  }
}

/**
 * Data hook for the Expansion Modules page (cloudli spec §12). Full CRUD —
 * create form + per-row Deactivate.
 */
export function useExpansionModules(): DataPageProps {
  const [modules, setModules] = useState<ExpansionModule[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading expansion modules', { route: '/expansion-modules' })
    setError('')
    try {
      const res = await api.expansionModules.list(DEMO_VS_CUSTOMER_ID)
      setModules(res.expansion_modules)
    } catch (e) {
      logger.error('Failed to load expansion modules', { error: String(e) })
      setError('Failed to load expansion modules')
      setModules([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allRows = useMemo(() => (modules ?? []).map(toRow), [modules])

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
      logger.info('Creating expansion module', { brand: values.brand, model: values.model })
      setError('')
      try {
        await api.expansionModules.add({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          description: values.description ?? '',
          brand: values.brand ?? '',
          model: values.model ?? '',
        })
        await load()
      } catch (e) {
        logger.error('Failed to create expansion module', { error: String(e) })
        setError('Failed to create expansion module')
      }
    },
    [load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating expansion module', { id: row.id })
      setError('')
      try {
        await api.expansionModules.deactivate(DEMO_VS_CUSTOMER_ID, row.id)
        await load()
      } catch (e) {
        logger.error('Failed to deactivate expansion module', { error: String(e) })
        setError('Failed to deactivate expansion module')
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
    a.download = 'expansion-modules.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported expansion modules CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Expansion Modules',
    description: 'Receptionist expansion module hardware configuration',
    loading: modules === null,
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
      submitLabel: 'Add Module',
      fields: [
        {
          key: 'description',
          label: 'Description',
          kind: 'text',
          placeholder: 'Reception desk module',
          required: true,
        },
        { key: 'brand', label: 'Brand', kind: 'text', placeholder: 'Yealink', required: true },
        { key: 'model', label: 'Model', kind: 'text', placeholder: 'EXP50', required: true },
      ],
      onSubmit: create,
    },
    emptyText: 'No expansion modules configured',
  }
}
