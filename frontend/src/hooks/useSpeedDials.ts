import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type SpeedDial } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'code', label: 'Code' },
  { key: 'phone_number', label: 'Phone Number' },
  { key: 'description', label: 'Description' },
]

function toRow(sd: SpeedDial): Record<string, string> {
  return {
    id: sd.id,
    code: sd.code,
    phone_number: sd.phone_number,
    description: sd.description,
  }
}

/**
 * Data hook for the Speed Dials page (cloudli spec §28). Full CRUD —
 * create form + per-row Deactivate.
 */
export function useSpeedDials(): DataPageProps {
  const [dials, setDials] = useState<SpeedDial[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading speed dials', { route: '/speed-dials' })
    setError('')
    try {
      const res = await api.speedDials.list(DEMO_VS_CUSTOMER_ID)
      setDials(res.speed_dials)
    } catch (e) {
      logger.error('Failed to load speed dials', { error: String(e) })
      setError('Failed to load speed dials')
      setDials([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allRows = useMemo(() => (dials ?? []).map(toRow), [dials])

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
      logger.info('Creating speed dial', { code: values.code, phone_number: values.phone_number })
      setError('')
      try {
        await api.speedDials.add({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          code: values.code ?? '',
          phone_number: values.phone_number ?? '',
          description: values.description ?? '',
        })
        await load()
      } catch (e) {
        logger.error('Failed to create speed dial', { error: String(e) })
        setError('Failed to create speed dial')
      }
    },
    [load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating speed dial', { id: row.id })
      setError('')
      try {
        await api.speedDials.deactivate(DEMO_VS_CUSTOMER_ID, row.id)
        await load()
      } catch (e) {
        logger.error('Failed to deactivate speed dial', { error: String(e) })
        setError('Failed to deactivate speed dial')
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
    a.download = 'speed-dials.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported speed dials CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Speed Dials',
    description: 'Dial *75 followed by a two-digit code to reach a full phone number',
    loading: dials === null,
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
          key: 'code',
          label: 'Code (00–99)',
          kind: 'text',
          placeholder: '01',
          required: true,
        },
        {
          key: 'phone_number',
          label: 'Phone Number',
          kind: 'text',
          placeholder: '+15551234567',
          required: true,
        },
        {
          key: 'description',
          label: 'Description',
          kind: 'text',
          placeholder: 'Main office',
        },
      ],
      onSubmit: create,
    },
    emptyText: 'No speed dials configured',
  }
}
