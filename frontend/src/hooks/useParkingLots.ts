import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type ParkingLot } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'description', label: 'Description' },
  { key: 'extension', label: 'Extension' },
  { key: 'ring_back_time_limit', label: 'Ring back Time Limit' },
]

function toRow(p: ParkingLot): Record<string, string> {
  return {
    // id is not a column, so it isn't rendered; the Deactivate row action reads it back.
    id: p.id,
    description: p.description || '',
    extension: p.extension,
    ring_back_time_limit: String(p.ring_back_time_limit),
  }
}

/**
 * Data hook for the Call Parking page (cloudli spec §10). Lists a customer's
 * parking lot extensions and returns a DataPageProps so every skin renders the
 * same behaviour. Full CRUD: the create form calls Add and the per-row
 * Deactivate action calls Deactivate, both re-fetching on success.
 */
export function useParkingLots(): DataPageProps {
  const [lots, setLots] = useState<ParkingLot[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading parking lots', { route: '/call-parking' })
    setError('')
    try {
      const res = await api.parkingLots.list(DEMO_VS_CUSTOMER_ID)
      setLots(res.parking_lots)
    } catch (e) {
      logger.error('Failed to load parking lots', { error: String(e) })
      setError('Failed to load parking lots')
      setLots([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allRows = useMemo(() => (lots ?? []).map(toRow), [lots])

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
      const ringBackTimeLimit = Number(values.ring_back_time_limit)
      logger.info('Creating parking lot', { extension: values.extension })
      setError('')
      try {
        await api.parkingLots.add({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          description: values.description || '',
          extension: values.extension ?? '',
          ring_back_time_limit:
            Number.isFinite(ringBackTimeLimit) && ringBackTimeLimit > 0
              ? ringBackTimeLimit
              : undefined,
        })
        await load()
      } catch (e) {
        logger.error('Failed to create parking lot', { error: String(e) })
        setError('Failed to create parking lot')
      }
    },
    [load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating parking lot', { id: row.id })
      setError('')
      try {
        await api.parkingLots.deactivate(DEMO_VS_CUSTOMER_ID, row.id)
        await load()
      } catch (e) {
        logger.error('Failed to deactivate parking lot', { error: String(e) })
        setError('Failed to deactivate parking lot')
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
    a.download = 'call-parking.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported parking lots CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Call Parking',
    description: 'Park calls to a dedicated extension until ring-back',
    loading: lots === null,
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
        { key: 'description', label: 'Description', kind: 'text', placeholder: 'Lobby parking' },
        { key: 'extension', label: 'Extension', kind: 'text', placeholder: '800', required: true },
        {
          key: 'ring_back_time_limit',
          label: 'Ring back Time Limit (seconds)',
          kind: 'text',
          placeholder: '60',
        },
      ],
      onSubmit: create,
    },
    emptyText: 'No call parking extensions configured',
  }
}
