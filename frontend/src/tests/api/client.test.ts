import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerError } = vi.hoisted(() => ({
  loggerError: vi.fn(),
}))

vi.mock('../../lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerError,
  },
}))

import {
  api,
  BackendOfflineError,
  type AddExtensionBody,
  type AddPhoneLineBody,
  type CustomerCreate,
} from '../../api/client'
import { resetBackendReachability } from '../../lib/backendReachability'

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
  // Module-level state in `lib/backendReachability`, so one test's 502 would
  // otherwise short-circuit every test declared after it.
  resetBackendReachability()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetBackendReachability()
})

describe('api.health', () => {
  it('returns status on 200', async () => {
    const body = { status: 'ok' }
    const fetchMock = mockFetch(200, body)

    const result = await api.health()

    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      '/health',
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('rejects on non-200', async () => {
    const fetchMock = mockFetch(503, { detail: 'down' })

    await expect(api.health()).rejects.toThrow('503')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('api.customers.get', () => {
  it('resolves with customer on 200', async () => {
    const body = {
      id: 'cust-1',
      vs_customer_id: 1,
      api_key: 'demo-key', // pragma: allowlist secret
      active: true,
      created_at: '2026-01-01T00:00:00Z',
    }
    const fetchMock = mockFetch(200, body)

    const result = await api.customers.get(1)

    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      '/vsapi/1.0.0/VsCustomer/Get/1',
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('throws on 404', async () => {
    const fetchMock = mockFetch(404, { detail: 'not found' })

    await expect(api.customers.get(999)).rejects.toThrow('404')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('api.customers.create', () => {
  it('sends POST and returns created customer', async () => {
    const payload: CustomerCreate = { vs_customer_id: 1, api_key: 'demo-key' }
    const body = {
      id: 'cust-1',
      vs_customer_id: 1,
      api_key: 'demo-key',
      active: true,
      created_at: '2026-01-01T00:00:00Z',
    }
    const fetchMock = mockFetch(200, body)

    const result = await api.customers.create(payload)

    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      '/vsapi/1.0.0/VsCustomer/Create',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('rejects on 409', async () => {
    const payload: CustomerCreate = { vs_customer_id: 1, api_key: 'demo-key' }
    const fetchMock = mockFetch(409, { detail: 'exists' })

    await expect(api.customers.create(payload)).rejects.toThrow('409')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('api.customers.getPhoneLines', () => {
  it('returns phone lines on 200', async () => {
    const body = [
      {
        id: 'line-1',
        customer_id: 'cust-1',
        phone_number: '+12125550111',
        provider_sid: 'PN123',
        sms_enabled: true,
        recording_enabled: false,
        active: true,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    const fetchMock = mockFetch(200, body)

    const result = await api.customers.getPhoneLines(1)

    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      '/vsapi/1.0.0/VsCustomer/GetPhoneLines/1',
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('rejects on 404', async () => {
    const fetchMock = mockFetch(404, { detail: 'customer missing' })

    await expect(api.customers.getPhoneLines(1)).rejects.toThrow('404')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('api.phoneLines.getCount', () => {
  it('returns count payload on 200', async () => {
    const body = { count: 3, vs_customer_id: 1 }
    const fetchMock = mockFetch(200, body)

    const result = await api.phoneLines.getCount(1)

    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      '/vsapi/1.0.0/PhoneLine/GetCount/1',
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('rejects on 404', async () => {
    const fetchMock = mockFetch(404, { detail: 'not found' })

    await expect(api.phoneLines.getCount(1)).rejects.toThrow('404')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('api.phoneLines.add', () => {
  it('sends POST with correct body', async () => {
    const payload: AddPhoneLineBody = { vs_customer_id: 1, area_code: '212' }
    const body = {
      id: 'line-1',
      customer_id: 'cust-1',
      phone_number: '+12125550111',
      provider_sid: 'PN123',
      sms_enabled: true,
      recording_enabled: false,
      active: true,
      created_at: '2026-01-01T00:00:00Z',
    }
    const fetchMock = mockFetch(200, body)

    const result = await api.phoneLines.add(payload)

    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      '/vsapi/1.0.0/PhoneLine/Add',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('throws and logs on 502', async () => {
    const payload: AddPhoneLineBody = { vs_customer_id: 1, area_code: '212' }
    const body = { detail: 'provider unavailable' }
    const fetchMock = mockFetch(502, body)

    await expect(api.phoneLines.add(payload)).rejects.toThrow('502')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(loggerError).toHaveBeenCalledWith(
      'API POST /vsapi/1.0.0/PhoneLine/Add failed',
      expect.objectContaining({
        status: 502,
        body: JSON.stringify(body),
      }),
    )
  })
})

describe('api.phoneLines.deactivate', () => {
  it('sends PUT with correct body', async () => {
    const payload = { vs_customer_id: 1, phone_number: '+12125550111' }
    const body = {
      id: 'line-1',
      customer_id: 'cust-1',
      phone_number: '+12125550111',
      provider_sid: 'PN123',
      sms_enabled: true,
      recording_enabled: false,
      active: false,
      created_at: '2026-01-01T00:00:00Z',
    }
    const fetchMock = mockFetch(200, body)

    const result = await api.phoneLines.deactivate(payload)

    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      '/vsapi/1.0.0/PhoneLine/Deactivate',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(payload),
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('rejects on 404', async () => {
    const fetchMock = mockFetch(404, { detail: 'line not found' })

    await expect(
      api.phoneLines.deactivate({ vs_customer_id: 1, phone_number: '+12125550111' }),
    ).rejects.toThrow('404')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('api.extensions.getAvailable', () => {
  it('returns available extension numbers on 200', async () => {
    const body = { available: ['101', '102'], vs_customer_id: 1 }
    const fetchMock = mockFetch(200, body)

    const result = await api.extensions.getAvailable(1, 100, 199)

    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      '/vsapi/1.0.0/VsExtension/GetAvailable/1/100/199',
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('rejects on 404', async () => {
    const fetchMock = mockFetch(404, { detail: 'customer missing' })

    await expect(api.extensions.getAvailable(1, 100, 199)).rejects.toThrow('404')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('api.extensions.add', () => {
  it('sends POST with correct body', async () => {
    const payload: AddExtensionBody = {
      vs_customer_id: 1,
      extension_number: '101',
      password: 'strong-pass', // pragma: allowlist secret
    }
    const body = {
      id: 'ext-1',
      customer_id: 'cust-1',
      extension_number: '101',
      sip_username: '101',
      sip_credential_sid: 'CR123',
      sip_domain_sid: 'SD123',
      active: true,
      created_at: '2026-01-01T00:00:00Z',
    }
    const fetchMock = mockFetch(200, body)

    const result = await api.extensions.add(payload)

    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      '/vsapi/1.0.0/VsExtension/Add',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('rejects on 400', async () => {
    const payload: AddExtensionBody = {
      vs_customer_id: 1,
      extension_number: '101',
    }
    const fetchMock = mockFetch(400, { detail: 'bad extension request' })

    await expect(api.extensions.add(payload)).rejects.toThrow('400')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('an absent backend', () => {
  it('stops calling out once a request came back 502', async () => {
    const fetchMock = mockFetch(502, { detail: 'no backend' })

    await expect(api.health()).rejects.toThrow('502')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(loggerError).toHaveBeenCalledTimes(1)

    await expect(api.customers.get(1)).rejects.toBeInstanceOf(BackendOfflineError)

    // The second call never reached the network, and reported nothing new.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(loggerError).toHaveBeenCalledTimes(1)
  })

  it('names the call it skipped', async () => {
    mockFetch(502, { detail: 'no backend' })
    await expect(api.health()).rejects.toThrow('502')

    await expect(api.extensions.list(7)).rejects.toThrow(
      '/api/v1/extensions?vs_customer_id=7',
    )
  })

  it('arms on a rejected fetch, and rethrows the transport error itself', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.health()).rejects.toThrow('Failed to fetch')
    await expect(api.health()).rejects.toBeInstanceOf(BackendOfflineError)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps calling after a 503 — that is a backend, just not ready', async () => {
    const fetchMock = mockFetch(503, { detail: 'starting up' })

    await expect(api.health()).rejects.toThrow('503')
    await expect(api.health()).rejects.toThrow('503')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps calling after an ordinary application failure', async () => {
    const fetchMock = mockFetch(500, { detail: 'unhandled' })

    await expect(api.health()).rejects.toThrow('500')
    await expect(api.health()).rejects.toThrow('500')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
