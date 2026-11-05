import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store is module state, so every test takes a fresh copy of it.
async function freshApi() {
  vi.resetModules()
  return (await import('../../api/demoClient')).demoApi
}

const CUSTOMER = 1

describe('the in-memory api', () => {
  let api: Awaited<ReturnType<typeof freshApi>>

  beforeEach(async () => {
    api = await freshApi()
  })

  it('reports itself healthy, with one customer and one SMS-capable line', async () => {
    expect((await api.health()).status).toBe('ok')
    expect((await api.customers.get(CUSTOMER)).vs_customer_id).toBe(CUSTOMER)
    const lines = await api.customers.getPhoneLines(CUSTOMER)
    expect(lines).toHaveLength(1)
    expect(lines[0].sms_enabled).toBe(true)
    expect((await api.phoneLines.getCount(CUSTOMER)).count).toBe(1)
  })

  it('adds and deactivates phone lines', async () => {
    const added = await api.phoneLines.add({ vs_customer_id: CUSTOMER, area_code: '514' })
    expect(added.phone_number).toMatch(/^\+1514555\d{4}$/)
    expect((await api.phoneLines.getCount(CUSTOMER)).count).toBe(2)

    const gone = await api.phoneLines.deactivate({
      vs_customer_id: CUSTOMER,
      phone_number: added.phone_number,
    })
    expect(gone.active).toBe(false)
    expect((await api.phoneLines.getCount(CUSTOMER)).count).toBe(1)
  })

  it('takes an added extension out of the available range', async () => {
    const before = await api.extensions.getAvailable(CUSTOMER, 100, 102)
    expect(before.available).toEqual(['100', '101', '102'])

    await api.extensions.add({ vs_customer_id: CUSTOMER, extension_number: '101' })

    const after = await api.extensions.getAvailable(CUSTOMER, 100, 102)
    expect(after.available).toEqual(['100', '102'])
  })

  it('lists made-up calls and SMS by default', async () => {
    expect((await api.calls.list(CUSTOMER)).events.length).toBeGreaterThan(0)
    expect((await api.sms.list(CUSTOMER)).messages.length).toBeGreaterThan(0)
  })

  it('honours limit and an inclusive date range on calls and SMS', async () => {
    const { events } = await api.calls.list(CUSTOMER, { limit: 3 })
    expect(events).toHaveLength(3)

    const day = (events[0].started_at ?? '').slice(0, 10)
    const within = await api.calls.list(CUSTOMER, { start: day, end: day })
    expect(within.events.length).toBeGreaterThan(0)
    expect(within.events.every(e => e.started_at?.startsWith(day))).toBe(true)

    expect((await api.calls.list(CUSTOMER, { start: '2099-01-01' })).events).toEqual([])
    expect((await api.sms.list(CUSTOMER, { end: '2000-01-01' })).messages).toEqual([])
  })

  it('shows a sent SMS at the top of the list', async () => {
    const res = await api.sms.send(CUSTOMER, {
      from_number: '+14155550000',
      to_number: '+14155550001',
      body: 'hello',
    })
    expect(res.success).toBe(true)

    const { messages } = await api.sms.list(CUSTOMER)
    expect(messages[0]).toMatchObject({ body: 'hello', direction: 'outbound' })
  })

  it.each(['extension', 'number'] as const)('summarizes the log by %s', async groupBy => {
    const { summary, group_by } = await api.calls.summary(CUSTOMER, { groupBy })
    expect(group_by).toBe(groupBy)
    expect(summary.length).toBeGreaterThan(1)
    for (const row of summary) {
      expect(row.answered_count).toBeLessThanOrEqual(row.call_count)
      expect(row.success_rate).toBeLessThanOrEqual(1)
    }
  })

  it('round-trips a record through add, list and deactivate, filling in defaults', async () => {
    expect((await api.conferences.list(CUSTOMER)).conferences).toEqual([])

    const added = await api.conferences.add({ vs_customer_id: CUSTOMER, number: '700' })
    expect(added).toMatchObject({ number: '700', max_participants: 10, active: true })
    expect((await api.conferences.list(CUSTOMER)).conferences).toEqual([added])

    await api.conferences.deactivate(CUSTOMER, added.id)
    expect((await api.conferences.list(CUSTOMER)).conferences).toEqual([])
  })

  it('rejects deactivating a record that does not exist', async () => {
    await expect(api.agents.deactivate(CUSTOMER, 'nope')).rejects.toThrow('No such record')
  })

  it('gives every record its own id', async () => {
    const a = await api.agents.add({ vs_customer_id: CUSTOMER, name: 'A' })
    const b = await api.agents.add({ vs_customer_id: CUSTOMER, name: 'B' })
    expect(a.id).not.toBe(b.id)
  })

  it('filters audio assets by kind, through the whole upload path', async () => {
    const { upload_url, s3_key } = await api.audioAssets.presignedUpload({
      vs_customer_id: CUSTOMER,
      name: 'hold.mp3',
      kind: 'moh',
    })
    await api.audioAssets.uploadToS3(upload_url, new File(['x'], 'hold.mp3'))
    await api.audioAssets.confirmUpload({
      vs_customer_id: CUSTOMER,
      name: 'hold.mp3',
      kind: 'moh',
      s3_key,
    })

    expect((await api.audioAssets.list(CUSTOMER, 'moh')).assets).toHaveLength(1)
    expect((await api.audioAssets.list(CUSTOMER, 'prompt')).assets).toEqual([])
    expect((await api.audioAssets.list(CUSTOMER)).assets).toHaveLength(1)
  })

  it('answers the read-only pages', async () => {
    expect((await api.voicemailDropEvents.list(CUSTOMER)).events).toEqual([])
    expect((await api.apiTokens.list(CUSTOMER)).tokens).toHaveLength(1)
  })
})
