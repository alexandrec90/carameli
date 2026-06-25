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
    summary: (
      customerId: number,
      params: { groupBy?: CallSummaryGroupBy; start?: string; end?: string } = {}
    ) => {
      const q = new URLSearchParams()
      if (params.groupBy) q.set('group_by', params.groupBy)
      if (params.start) q.set('start', params.start)
      if (params.end) q.set('end', params.end)
      const qs = q.toString()
      return request<CallSummaryResponse>(
        `/vsapi/1.0.0/VsCall/Summary/${customerId}${qs ? `?${qs}` : ''}`
      )
    },
  },

  webhooks: {
    list: (customerId: number) =>
      request<WebhookSubscriptionListResponse>(`/vsapi/1.0.0/VsWebhook/List/${customerId}`),
    add: (body: AddWebhookSubscriptionBody) =>
      request<WebhookSubscription>('/vsapi/1.0.0/VsWebhook/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (customerId: number, subscriptionId: string) =>
      request<WebhookSubscription>(
        `/vsapi/1.0.0/VsWebhook/Deactivate/${customerId}/${subscriptionId}`,
        { method: 'PUT' }
      ),
  },

  sms: {
    list: (
      customerId: number,
      params: { start?: string; end?: string; limit?: number } = {}
    ) => {
      const q = new URLSearchParams()
      if (params.start) q.set('start', params.start)
      if (params.end) q.set('end', params.end)
      if (params.limit) q.set('limit', String(params.limit))
      const qs = q.toString()
      return request<SmsMessageListResponse>(
        `/vsapi/1.0.0/VsMessaging/Sms/List/${customerId}${qs ? `?${qs}` : ''}`
      )
    },
  },

  groupExtensions: {
    list: (customerId: number) =>
      request<GroupExtensionListResponse>(`/vsapi/1.0.0/VsGroupExtension/List/${customerId}`),
    add: (body: AddGroupExtensionBody) =>
      request<GroupExtension>('/vsapi/1.0.0/VsGroupExtension/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (customerId: number, groupId: string) =>
      request<GroupExtension>(
        `/vsapi/1.0.0/VsGroupExtension/Deactivate/${customerId}/${groupId}`,
        { method: 'PUT' }
      ),
  },

  intercomGroups: {
    list: (customerId: number) =>
      request<IntercomGroupListResponse>(`/vsapi/1.0.0/VsIntercom/List/${customerId}`),
    add: (body: AddIntercomGroupBody) =>
      request<IntercomGroup>('/vsapi/1.0.0/VsIntercom/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (customerId: number, groupId: string) =>
      request<IntercomGroup>(`/vsapi/1.0.0/VsIntercom/Deactivate/${customerId}/${groupId}`, {
        method: 'PUT',
      }),
  },

  multicastGroups: {
    list: (customerId: number) =>
      request<MulticastGroupListResponse>(`/vsapi/1.0.0/VsMulticast/List/${customerId}`),
    add: (body: AddMulticastGroupBody) =>
      request<MulticastGroup>('/vsapi/1.0.0/VsMulticast/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (customerId: number, groupId: string) =>
      request<MulticastGroup>(`/vsapi/1.0.0/VsMulticast/Deactivate/${customerId}/${groupId}`, {
        method: 'PUT',
      }),
  },

  conferences: {
    list: (customerId: number) =>
      request<ConferenceListResponse>(`/vsapi/1.0.0/VsConference/List/${customerId}`),
    add: (body: AddConferenceBody) =>
      request<Conference>('/vsapi/1.0.0/VsConference/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (customerId: number, conferenceId: string) =>
      request<Conference>(
        `/vsapi/1.0.0/VsConference/Deactivate/${customerId}/${conferenceId}`,
        { method: 'PUT' }
      ),
  },

  parkingLots: {
    list: (customerId: number) =>
      request<ParkingLotListResponse>(`/vsapi/1.0.0/VsParking/List/${customerId}`),
    add: (body: AddParkingLotBody) =>
      request<ParkingLot>('/vsapi/1.0.0/VsParking/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (customerId: number, lotId: string) =>
      request<ParkingLot>(`/vsapi/1.0.0/VsParking/Deactivate/${customerId}/${lotId}`, {
        method: 'PUT',
      }),
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

export type CallSummaryGroupBy = 'extension' | 'number'

export interface CallSummaryRow {
  group_key: string
  call_count: number
  answered_count: number
  total_duration_seconds: number
  avg_duration_seconds: number
  success_rate: number
}

export interface CallSummaryResponse {
  summary: CallSummaryRow[]
  group_by: CallSummaryGroupBy
  vs_customer_id: number
}

export interface WebhookSubscription {
  id: string
  customer_id: string
  description: string
  uri: string
  events: string[]
  enabled: boolean
  active: boolean
  created_at: string
}

export interface WebhookSubscriptionListResponse {
  subscriptions: WebhookSubscription[]
  vs_customer_id: number
}

export interface AddWebhookSubscriptionBody {
  vs_customer_id: number
  description?: string
  uri: string
  events: string[]
  enabled?: boolean
}

export interface SmsMessage {
  id: string
  direction: string
  from_number: string
  to_number: string
  body: string
  message_sid: string | null
  delivery_status: string | null
  error_code: string | null
  created_at: string
}

export interface SmsMessageListResponse {
  messages: SmsMessage[]
  vs_customer_id: number
}

export interface GroupExtension {
  id: string
  customer_id: string
  description: string
  number: string
  subscribed_extensions: string[]
  active: boolean
  created_at: string
}

export interface GroupExtensionListResponse {
  group_extensions: GroupExtension[]
  vs_customer_id: number
}

export interface AddGroupExtensionBody {
  vs_customer_id: number
  description?: string
  number: string
  subscribed_extensions: string[]
}

export interface IntercomGroup {
  id: string
  customer_id: string
  number: string
  description: string
  subscriber_extensions: string[]
  bidirectional_audio: boolean
  expiry: string | null
  active: boolean
  created_at: string
}

export interface IntercomGroupListResponse {
  intercom_groups: IntercomGroup[]
  vs_customer_id: number
}

export interface AddIntercomGroupBody {
  vs_customer_id: number
  number: string
  description?: string
  subscriber_extensions: string[]
  bidirectional_audio?: boolean
  expiry?: string | null
}

export interface MulticastGroup {
  id: string
  customer_id: string
  extension: string
  description: string
  extensions: string[]
  users: string[]
  active: boolean
  created_at: string
}

export interface MulticastGroupListResponse {
  multicast_groups: MulticastGroup[]
  vs_customer_id: number
}

export interface AddMulticastGroupBody {
  vs_customer_id: number
  extension: string
  description?: string
  extensions: string[]
  users: string[]
}

export interface Conference {
  id: string
  customer_id: string
  number: string
  description: string
  max_participants: number
  recorded_calls: boolean
  active: boolean
  created_at: string
}

export interface ConferenceListResponse {
  conferences: Conference[]
  vs_customer_id: number
}

export interface AddConferenceBody {
  vs_customer_id: number
  number: string
  description?: string
  max_participants?: number
  recorded_calls?: boolean
}

export interface ParkingLot {
  id: string
  customer_id: string
  description: string
  extension: string
  ring_back_time_limit: number
  active: boolean
  created_at: string
}

export interface ParkingLotListResponse {
  parking_lots: ParkingLot[]
  vs_customer_id: number
}

export interface AddParkingLotBody {
  vs_customer_id: number
  description?: string
  extension: string
  ring_back_time_limit?: number
}
