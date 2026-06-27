import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioAsset } from '../api/client'

const listMock = vi.fn()
const presignedUploadMock = vi.fn()
const uploadToS3Mock = vi.fn()
const confirmUploadMock = vi.fn()
const deactivateMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    audioAssets: {
      list: (...args: unknown[]) => listMock(...args),
      presignedUpload: (...args: unknown[]) => presignedUploadMock(...args),
      uploadToS3: (...args: unknown[]) => uploadToS3Mock(...args),
      confirmUpload: (...args: unknown[]) => confirmUploadMock(...args),
      deactivate: (...args: unknown[]) => deactivateMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useAudioAssets } from '../hooks/useAudioAssets'

function makeAsset(over: Partial<AudioAsset> = {}): AudioAsset {
  return {
    id: 'asset-1',
    customer_id: 'cust-1',
    kind: 'music',
    name: 'My Track',
    s3_key: 'audio/cust-1/abc',
    playback_url: 'https://s3.example.com/audio/cust-1/abc?sig=x',
    duration_seconds: 120,
    active: true,
    created_at: '2026-06-27T10:00:00',
    ...over,
  }
}

describe('useAudioAssets', () => {
  beforeEach(() => {
    listMock.mockReset()
    presignedUploadMock.mockReset()
    uploadToS3Mock.mockReset()
    confirmUploadMock.mockReset()
    deactivateMock.mockReset()
  })

  it('loads assets and maps them to rows with an audio column', async () => {
    listMock.mockResolvedValue({ assets: [makeAsset()], vs_customer_id: 1 })
    const { result } = renderHook(() => useAudioAssets('music', 'Music Tracks', 'desc'))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns.find((c) => c.kind === 'audio')).toBeDefined()
    const row = result.current.rows[0]
    expect(row['name']).toBe('My Track')
    expect(row['duration']).toBe('120s')
    expect(row['playback']).toBe('https://s3.example.com/audio/cust-1/abc?sig=x')
    expect(row['id']).toBe('asset-1')
    expect(result.current.columns.map((c) => c.key)).not.toContain('id')
  })

  it('surfaces an error and empties rows when the request fails', async () => {
    listMock.mockRejectedValue(new Error('503 boom'))
    const { result } = renderHook(() => useAudioAssets('music', 'Music Tracks', 'desc'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load audio assets')
    expect(result.current.rows).toEqual([])
  })

  it('exposes a file upload form with name and file fields', async () => {
    listMock.mockResolvedValue({ assets: [], vs_customer_id: 1 })
    const { result } = renderHook(() => useAudioAssets('music', 'Music Tracks', 'desc'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.form?.fields.map((f) => f.key)).toEqual(['name', 'file'])
    expect(result.current.form?.fields.find((f) => f.key === 'file')?.kind).toBe('file')
    expect(result.current.rowActions?.[0].key).toBe('deactivate')
  })

  it('upload form runs presignedUpload → uploadToS3 → confirmUpload then re-fetches', async () => {
    listMock.mockResolvedValue({ assets: [], vs_customer_id: 1 })
    presignedUploadMock.mockResolvedValue({
      upload_url: 'https://s3.example.com/upload',
      s3_key: 'audio/cust/key',
    })
    uploadToS3Mock.mockResolvedValue(undefined)
    confirmUploadMock.mockResolvedValue(makeAsset())

    const { result } = renderHook(() => useAudioAssets('music', 'Music Tracks', 'desc'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(listMock).toHaveBeenCalledTimes(1)

    const fakeFile = new File(['audio'], 'track.mp3', { type: 'audio/mpeg' })
    await act(async () => {
      await result.current.form!.onSubmit({ name: 'My Track' }, { file: fakeFile })
    })

    expect(presignedUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Track', kind: 'music' })
    )
    expect(uploadToS3Mock).toHaveBeenCalledWith('https://s3.example.com/upload', fakeFile)
    expect(confirmUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Track', kind: 'music', s3_key: 'audio/cust/key' })
    )
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces an error when upload fails', async () => {
    listMock.mockResolvedValue({ assets: [], vs_customer_id: 1 })
    presignedUploadMock.mockRejectedValue(new Error('503 S3 not configured'))

    const { result } = renderHook(() => useAudioAssets('music', 'Music Tracks', 'desc'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const fakeFile = new File(['audio'], 'track.mp3', { type: 'audio/mpeg' })
    await act(async () => {
      await result.current.form!.onSubmit({ name: 'Fail' }, { file: fakeFile })
    })

    expect(result.current.error).toBe('Failed to upload audio asset')
  })

  it('deactivate row action calls deactivate and re-fetches', async () => {
    listMock.mockResolvedValue({ assets: [makeAsset({ id: 'asset-99' })], vs_customer_id: 1 })
    deactivateMock.mockResolvedValue(makeAsset({ id: 'asset-99', active: false }))

    const { result } = renderHook(() => useAudioAssets('music', 'Music Tracks', 'desc'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      result.current.rowActions![0].onClick(result.current.rows[0])
    })

    await waitFor(() => expect(deactivateMock).toHaveBeenCalledWith(1, 'asset-99'))
    expect(listMock).toHaveBeenCalledTimes(2)
  })
})
