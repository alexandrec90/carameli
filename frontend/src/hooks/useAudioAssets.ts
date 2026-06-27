import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type AudioAsset } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'duration', label: 'Duration' },
  { key: 'created_at', label: 'Added' },
  { key: 'playback', label: 'Preview', kind: 'audio' },
]

function toRow(a: AudioAsset): Record<string, string> {
  return {
    id: a.id,
    name: a.name,
    duration: a.duration_seconds != null ? `${a.duration_seconds}s` : '—',
    created_at: a.created_at ? a.created_at.slice(0, 10) : '',
    playback: a.playback_url ?? '',
  }
}

/**
 * Data hook for audio asset pages (cloudli spec §18–22, §25, §29). Parameterised
 * by `kind` so each page (music, hold, ad, prompt, greeting, broadcast) gets its
 * own scoped list, upload form, and deactivate action.
 */
export function useAudioAssets(
  kind: string,
  title: string,
  description: string,
): DataPageProps {
  const [assets, setAssets] = useState<AudioAsset[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading audio assets', { kind, route: `/${kind}` })
    setError('')
    try {
      const res = await api.audioAssets.list(DEMO_VS_CUSTOMER_ID, kind)
      setAssets(res.assets)
    } catch (e) {
      logger.error('Failed to load audio assets', { kind, error: String(e) })
      setError('Failed to load audio assets')
      setAssets([])
    }
  }, [kind])

  useEffect(() => {
    void load()
  }, [load])

  const allRows = useMemo(() => (assets ?? []).map(toRow), [assets])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allRows
    return allRows.filter((r) => r.name.toLowerCase().includes(q))
  }, [allRows, search])

  const onFilterChange = useCallback((key: string, value: string) => {
    if (key === 'search') setSearch(value)
  }, [])

  const upload = useCallback(
    async (values: Record<string, string>, files?: Record<string, File | null>) => {
      const file = files?.['file'] ?? null
      if (!file) {
        setError('Please select an audio file')
        return
      }
      const name = values['name'] ?? file.name
      logger.info('Uploading audio asset', { kind, name })
      setError('')
      try {
        const { upload_url, s3_key } = await api.audioAssets.presignedUpload({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          name,
          kind,
          content_type: file.type || 'audio/mpeg',
        })
        await api.audioAssets.uploadToS3(upload_url, file)
        await api.audioAssets.confirmUpload({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          name,
          kind,
          s3_key,
        })
        await load()
      } catch (e) {
        logger.error('Failed to upload audio asset', { kind, error: String(e) })
        setError('Failed to upload audio asset')
      }
    },
    [kind, load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating audio asset', { id: row['id'], kind })
      setError('')
      try {
        await api.audioAssets.deactivate(DEMO_VS_CUSTOMER_ID, row['id'])
        await load()
      } catch (e) {
        logger.error('Failed to deactivate audio asset', { error: String(e) })
        setError('Failed to deactivate audio asset')
      }
    },
    [kind, load],
  )

  return {
    title,
    description,
    loading: assets === null,
    error,
    filters: [{ key: 'search', label: 'Search', kind: 'search', value: search }],
    onFilterChange,
    columns: COLUMNS,
    rows,
    actions: [
      { key: 'refresh', label: 'Refresh', onClick: () => void load(), variant: 'primary' },
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
      newLabel: 'Upload',
      submitLabel: 'Upload',
      fields: [
        { key: 'name', label: 'Name', kind: 'text', placeholder: 'My track', required: true },
        { key: 'file', label: 'Audio file', kind: 'file', accept: 'audio/*', required: true },
      ],
      onSubmit: upload,
    },
    emptyText: `No ${kind} audio assets`,
  }
}
