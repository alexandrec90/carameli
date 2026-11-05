import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `VITE_LIVE_BACKEND` is the one switch between the demo and the real app. What each side
// does has its own tests; these say which side each selector hands out.

async function selected() {
  const [client, softphone, sms, tables] = await Promise.all([
    import('../api/client'),
    import('../hooks/useSoftphone'),
    import('../hooks/useSmsConversations'),
    import('../hooks/useLiveTables'),
  ])
  return {
    api: client.api,
    useSoftphone: softphone.useSoftphone,
    useSmsConversations: sms.useSmsConversations,
    useLiveTables: tables.useLiveTables,
  }
}

async function implementations() {
  const [demoClient, liveClient, demoPhone, livePhone, demoSms, liveSms, demoTables, polled] =
    await Promise.all([
      import('../api/demoClient'),
      import('../api/liveClient'),
      import('../hooks/useDemoSoftphone'),
      import('../hooks/useLiveSoftphone'),
      import('../hooks/useDemoSmsConversations'),
      import('../hooks/useLiveSmsConversations'),
      import('../hooks/useDemoTables'),
      import('../hooks/usePolledTables'),
    ])
  return {
    demo: {
      api: demoClient.demoApi,
      useSoftphone: demoPhone.useDemoSoftphone,
      useSmsConversations: demoSms.useDemoSmsConversations,
      useLiveTables: demoTables.useDemoTables,
    },
    live: {
      api: liveClient.liveApi,
      useSoftphone: livePhone.useLiveSoftphone,
      useSmsConversations: liveSms.useLiveSmsConversations,
      useLiveTables: polled.usePolledTables,
    },
  }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the selectors', () => {
  it('hand out the demo when nothing sets the switch', async () => {
    vi.stubEnv('VITE_LIVE_BACKEND', undefined)
    expect(await selected()).toEqual((await implementations()).demo)
  })

  it.each(['false', '0', '1', 'TRUE', 'yes', ''])('hand out the demo for %j', async value => {
    vi.stubEnv('VITE_LIVE_BACKEND', value)
    expect(await selected()).toEqual((await implementations()).demo)
  })

  it('hand out the real thing for exactly "true"', async () => {
    vi.stubEnv('VITE_LIVE_BACKEND', 'true')
    expect(await selected()).toEqual((await implementations()).live)
  })
})
