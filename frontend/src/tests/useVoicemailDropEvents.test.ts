import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoicemailDropEvent } from '../api/client'

const listMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    voicemailDropEvents: {
      list: (...args: unknown[]) => listMock(...args),
    },
  },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useVoicemailDropEvents } from '../hooks/useVoicemailDropEvents'

function makeEvent(over: Partial<VoicemailDropEvent> = {}): VoicemailDropEvent {
  return {
    id: 'event-1',
    customer_id: 'cust-1',
    to_number: '+15550001111',
    audio_asset_id: null,
    call_sid: 'call-abc',
    status: 'initiated',
    created_at: '2026-06-27T10:00:00',
    ...over,
  }
}

describe('useVoicemailDropEvents', () => {
  // The block body is load-bearing — see the matching comment in useApiToken.test.ts.
  beforeEach(() => {
    listMock.mockReset()
  })

  it('loads events and maps them to rows', async () => {
    listMock.mockResolvedValue({ events: [makeEvent()], vs_customer_id: 1 })
    const { result } = renderHook(() =>
      useVoicemailDropEvents('Mailbox Drop History', 'desc')
    )

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.columns.map((c) => c.key)).toEqual([
      'to_number',
      'status',
      'call_sid',
      'created_at',
    ])
    const row = result.current.rows[0]
    expect(row['to_number']).toBe('+15550001111')
    expect(row['status']).toBe('initiated')
    expect(row['call_sid']).toBe('call-abc')
  })

  it('surfaces an error when the request fails', async () => {
    listMock.mockRejectedValue(new Error('500 boom'))
    const { result } = renderHook(() =>
      useVoicemailDropEvents('Mailbox Drop History', 'desc')
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load voicemail drop events')
    expect(result.current.rows).toEqual([])
  })

  it('renders the title and description passed in', async () => {
    listMock.mockResolvedValue({ events: [], vs_customer_id: 1 })
    const { result } = renderHook(() =>
      useVoicemailDropEvents('My Custom Title', 'My description')
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.title).toBe('My Custom Title')
    expect(result.current.description).toBe('My description')
  })

  it('has no create form (read-only page)', async () => {
    listMock.mockResolvedValue({ events: [], vs_customer_id: 1 })
    const { result } = renderHook(() =>
      useVoicemailDropEvents('Mailbox Drop History', 'desc')
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.form).toBeUndefined()
    expect(result.current.rowActions).toBeUndefined()
  })
})
