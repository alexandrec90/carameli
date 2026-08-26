import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const callsList = vi.fn()
const smsList = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    calls: { list: (...args: unknown[]) => callsList(...args) },
    sms: { list: (...args: unknown[]) => smsList(...args) },
  },
}))
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import { newTable, liveTable } from '../../skins/comic-book/editor/tableValidate'
import type { ImgTransform } from '../../skins/comic-book/editor/types'
import {
  liveTableSources,
  useLiveTableImages,
  withLiveRows,
} from '../../skins/comic-book/useLiveTableImages'

// A real shipped picture, so this file does not name an asset public/ has to carry.
const SRC = seedConfig().images[0].src

function img(over: Partial<ImgTransform> = {}): ImgTransform {
  return {
    panel: 0,
    src: SRC,
    alt: '',
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    anchor: 'center',
    spill: false,
    ...over,
  }
}

describe('liveTableSources', () => {
  it('names nothing for a page of ordinary pictures', () => {
    expect(liveTableSources([img(), img({ table: newTable() })])).toEqual([])
  })

  it('names each feed once, however many surfaces show it', () => {
    const images = [
      img({ table: liveTable(newTable(), 'calls') }),
      img({ table: liveTable(newTable(), 'sms') }),
      img({ table: liveTable(newTable(), 'calls') }),
    ]
    expect(liveTableSources(images)).toEqual(['calls', 'sms'])
  })
})

describe('withLiveRows', () => {
  it('hands back the very same array when no surface is live', () => {
    // Identity is the point: this runs on every render of the page, and a new array
    // would repaint every panel — including the Ben-Day canvases — for nothing.
    const images = [img(), img({ table: newTable() })]
    expect(withLiveRows(images, { calls: [['x']] })).toBe(images)
  })

  it('puts the feed\'s rows on the surface that named it', () => {
    const images = [img({ table: liveTable(newTable(), 'calls') })]
    const out = withLiveRows(images, { calls: [['14:30', 'In', 'a', 'b', 'ringing']] })
    expect(out[0]?.table?.data).toEqual([['14:30', 'In', 'a', 'b', 'ringing']])
    expect(out[0]?.table?.source).toBe('calls')
  })

  it('leaves an authored surface on the same page alone', () => {
    const authored = newTable()
    const images = [img({ table: liveTable(newTable(), 'calls') }), img({ table: authored })]
    const out = withLiveRows(images, { calls: [['a']] })
    expect(out[1]?.table?.data).toEqual(authored.data)
    expect(out[1]).toBe(images[1])
  })

  it('shows an empty surface until the first response arrives', () => {
    const images = [img({ table: liveTable(newTable(), 'sms') })]
    expect(withLiveRows(images, {})[0]?.table?.data).toEqual([])
  })

  it('keeps the picture identical when the same rows come round again', () => {
    const rows = { calls: [['a']] }
    const images = [img({ table: liveTable(newTable(), 'calls') })]
    const first = withLiveRows(images, rows)
    // The hook hands back the identical row array when a poll finds nothing new, so the
    // second pass has nothing to change and must not rebuild the picture either.
    expect(withLiveRows(first, rows)[0]).toBe(first[0])
  })
})

describe('useLiveTableImages', () => {
  beforeEach(() => {
    callsList.mockReset()
    smsList.mockReset()
    callsList.mockResolvedValue({
      events: [
        {
          id: 'id-1',
          call_sid: 'CA1',
          direction: 'outbound',
          from_number: '+14155550000',
          to_number: '+14155550001',
          started_at: '2026-08-25T16:45:00',
          ended_at: null,
          duration_seconds: null,
          recording_url: null,
          status: 'ringing',
          posted: false,
          created_at: '2026-08-25T16:45:00',
        },
      ],
      vs_customer_id: 1,
    })
    smsList.mockResolvedValue({ messages: [], vs_customer_id: 1 })
  })

  it('fetches nothing for a page whose surfaces are all authored', async () => {
    const images = [img({ table: newTable() })]
    const { result } = renderHook(() => useLiveTableImages(images))
    await waitFor(() => expect(result.current).toBe(images))
    expect(callsList).not.toHaveBeenCalled()
  })

  it('fills a live surface from the records', async () => {
    const images = [img({ table: liveTable(newTable(), 'calls') })]
    const { result } = renderHook(() => useLiveTableImages(images))
    await waitFor(() => expect(result.current[0]?.table?.data).toHaveLength(1))
    expect(result.current[0]?.table?.data[0]).toEqual([
      '16:45',
      'Out',
      '+14155550000',
      '+14155550001',
      'ringing',
    ])
    expect(smsList).not.toHaveBeenCalled()
  })
})
