import { logger } from '../lib/logger'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    logger.error(`API ${options.method ?? 'GET'} ${path} failed`, { status: res.status, body: text })
    throw new Error(`${res.status} ${text}`)
  }
  return res.json()
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  customers: {
    get: (id: number) =>
      request<Customer>(`/vsapi/1.0.0/VsCustomer/Get/${id}`),
    create: (body: CustomerCreate) =>
      request<Customer>('/vsapi/1.0.0/VsCustomer/Create', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getPhoneLines: (id: number) =>
      request<PhoneLine[]>(`/vsapi/1.0.0/VsCustomer/GetPhoneLines/${id}`),
  },

  phoneLines: {
    getCount: (customerId: number) =>
      request<{ count: number; vs_customer_id: number }>(
        `/vsapi/1.0.0/PhoneLine/GetCount/${customerId}`
      ),
    add: (body: AddPhoneLineBody) =>
      request<PhoneLine>('/vsapi/1.0.0/PhoneLine/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (body: { vs_customer_id: number; phone_number: string }) =>
      request<PhoneLine>('/vsapi/1.0.0/PhoneLine/Deactivate', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
  },

  extensions: {
    getAvailable: (customerId: number, start: number, end: number) =>
      request<{ available: string[]; vs_customer_id: number }>(
        `/vsapi/1.0.0/VsExtension/GetAvailable/${customerId}/${start}/${end}`
      ),
    add: (body: AddExtensionBody) =>
      request<Extension>('/vsapi/1.0.0/VsExtension/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  calls: {
    list: (
      customerId: number,
      params: { start?: string; end?: string; limit?: number } = {}
    ) => {
      const q = new URLSearchParams()
      if (params.start) q.set('start', params.start)
      if (params.end) q.set('end', params.end)
      if (params.limit) q.set('limit', String(params.limit))
      const qs = q.toString()
      return request<CallEventListResponse>(
        `/vsapi/1.0.0/VsCall/List/${customerId}${qs ? `?${qs}` : ''}`
      )
    },
  },
}

// Types
export interface Customer {
  id: string
  vs_customer_id: number
  api_key: string
  active: boolean
  created_at: string
}

export interface CustomerCreate {
  vs_customer_id: number
  api_key: string
}

export interface PhoneLine {
  id: string
  customer_id: string
  phone_number: string
  provider_sid: string
  sms_enabled: boolean
  recording_enabled: boolean
  active: boolean
  created_at: string
}

export interface Extension {
  id: string
  customer_id: string
  extension_number: string
  sip_username: string
  sip_credential_sid: string | null
  sip_domain_sid: string | null
  active: boolean
  created_at: string
}

export interface AddPhoneLineBody {
  vs_customer_id: number
  area_code?: string
  phone_number?: string
}

export interface AddExtensionBody {
  vs_customer_id: number
  extension_number: string
  password?: string
}

export interface CallEvent {
  id: string
  call_sid: string
  direction: string
  from_number: string | null
  to_number: string | null
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  recording_url: string | null
  status: string | null
  posted: boolean
  created_at: string
}

export interface CallEventListResponse {
  events: CallEvent[]
  vs_customer_id: number
}
