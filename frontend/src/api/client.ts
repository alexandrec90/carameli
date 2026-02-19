const BASE = import.meta.env.VITE_API_BASE_URL ?? ''
const API_KEY = import.meta.env.VITE_API_KEY ?? 'hlUnmWwpQVyGbg8oV2sgBsMMypjoPI6Q7fq9xgj6nb8VrnKIonewB4fWspqnEtfq'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      ...options.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
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
}

// Types
export interface Customer {
  id: string
  vs_customer_id: number
  api_key: string
  twilio_account_sid: string
  active: boolean
  created_at: string
}

export interface CustomerCreate {
  vs_customer_id: number
  api_key: string
  twilio_account_sid: string
  twilio_auth_token: string
}

export interface PhoneLine {
  id: string
  customer_id: string
  phone_number: string
  twilio_sid: string
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
  twilio_domain_sid: string | null
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
