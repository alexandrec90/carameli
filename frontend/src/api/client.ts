import {
  isBackendOffline,
  isUnreachableStatus,
  markBackendOffline,
} from '../lib/backendReachability'
import { logger } from '../lib/logger'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

/**
 * Thrown instead of calling a backend already known to be absent. Carries the path
 * so a rejection still says which call was skipped. See `lib/backendReachability`.
 */
export class BackendOfflineError extends Error {
  constructor(readonly path: string) {
    super(`Backend not reachable — skipped ${path}`)
    this.name = 'BackendOfflineError'
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // In a UI-only preview every call fails the same way for the same reason, so
  // after the first one there is nothing to learn from making the rest. Short-
  // circuiting is what keeps a route change from replaying the whole wall of
  // failed requests. Only ever armed in DEV — see `lib/backendReachability`.
  if (isBackendOffline()) throw new BackendOfflineError(path)

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  } catch (e) {
    // A rejected fetch is a transport failure — no server answered at all.
    markBackendOffline()
    throw e
  }
  if (!res.ok) {
    const text = await res.text()
    // Before the log, so the first failure is already reported as the preview
    // condition it is rather than as an app fault.
    if (isUnreachableStatus(res.status)) markBackendOffline()
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
    list: (customerId: number) =>
      request<ExtensionListResponse>(`/api/v1/extensions?vs_customer_id=${customerId}`),
    // POST, not GET: the endpoint mints a password when the extension has none
    // stored, and `rotate` forces a fresh one (which is also how a leaked
    // credential is revoked).
    webphoneCredential: (extensionId: string, rotate = false) =>
      request<WebphoneCredential>(
        `/api/v1/extensions/${extensionId}/webphone-credential${rotate ? '?rotate=true' : ''}`,
        { method: 'POST' }
      ),
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
      params: { start?: string; end?: string; limit?: number; peer?: string } = {}
    ) => {
      const q = new URLSearchParams()
      if (params.start) q.set('start', params.start)
      if (params.end) q.set('end', params.end)
      if (params.limit) q.set('limit', String(params.limit))
      // One conversation rather than the whole history — see the `peer` param on
      // GET /VsMessaging/Sms/List. Must be E.164; the backend rejects anything else.
      if (params.peer) q.set('peer', params.peer)
      const qs = q.toString()
      return request<SmsMessageListResponse>(
        `/vsapi/1.0.0/VsMessaging/Sms/List/${customerId}${qs ? `?${qs}` : ''}`
      )
    },
    send: (customerId: number, body: SendSmsBody) =>
      request<SmsStatusResponse>(`/vsapi/1.0.0/VsMessaging/Sms/Send/${customerId}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
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

  agents: {
    list: (customerId: number) =>
      request<AgentListResponse>(`/vsapi/1.0.0/VsAgent/List/${customerId}`),
    add: (body: AddAgentBody) =>
      request<Agent>('/vsapi/1.0.0/VsAgent/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (customerId: number, agentId: string) =>
      request<Agent>(`/vsapi/1.0.0/VsAgent/Deactivate/${customerId}/${agentId}`, {
        method: 'PUT',
      }),
  },

  callQueues: {
    list: (customerId: number) =>
      request<CallQueueListResponse>(`/vsapi/1.0.0/VsCallQueue/List/${customerId}`),
    add: (body: AddCallQueueBody) =>
      request<CallQueue>('/vsapi/1.0.0/VsCallQueue/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (customerId: number, queueId: string) =>
      request<CallQueue>(`/vsapi/1.0.0/VsCallQueue/Deactivate/${customerId}/${queueId}`, {
        method: 'PUT',
      }),
  },

  agentSkills: {
    list: (customerId: number) =>
      request<AgentSkillListResponse>(`/vsapi/1.0.0/VsAgentSkill/List/${customerId}`),
    add: (body: AddAgentSkillBody) =>
      request<AgentSkill>('/vsapi/1.0.0/VsAgentSkill/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (customerId: number, skillId: string) =>
      request<AgentSkill>(`/vsapi/1.0.0/VsAgentSkill/Deactivate/${customerId}/${skillId}`, {
        method: 'PUT',
      }),
  },

  audioAssets: {
    list: (customerId: number, kind?: string) => {
      const qs = kind ? `?kind=${encodeURIComponent(kind)}` : ''
      return request<AudioAssetListResponse>(`/vsapi/1.0.0/VsAudio/List/${customerId}${qs}`)
    },
    presignedUpload: (body: PresignedUploadBody) =>
      request<PresignedUploadResponse>('/vsapi/1.0.0/VsAudio/PresignedUpload', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    confirmUpload: (body: ConfirmUploadBody) =>
      request<AudioAsset>('/vsapi/1.0.0/VsAudio/ConfirmUpload', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    uploadToS3: async (uploadUrl: string, file: File): Promise<void> => {
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'audio/mpeg' },
      })
      if (!res.ok) {
        const text = await res.text()
        logger.error('S3 upload failed', { status: res.status, body: text })
        throw new Error(`${res.status} ${text}`)
      }
    },
    deactivate: (customerId: number, assetId: string) =>
      request<AudioAsset>(`/vsapi/1.0.0/VsAudio/Deactivate/${customerId}/${assetId}`, {
        method: 'PUT',
      }),
  },

  voicemailDropEvents: {
    list: (customerId: number) =>
      request<VoicemailDropEventListResponse>(`/vsapi/1.0.0/VsMailboxDrop/List/${customerId}`),
  },

  exemptionCodes: {
    list: (customerId: number) =>
      request<ExemptionCodeListResponse>(`/vsapi/1.0.0/VsExemptionCode/List/${customerId}`),
    add: (body: AddExemptionCodeBody) =>
      request<ExemptionCode>('/vsapi/1.0.0/VsExemptionCode/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (customerId: number, exemptionId: string) =>
      request<ExemptionCode>(
        `/vsapi/1.0.0/VsExemptionCode/Deactivate/${customerId}/${exemptionId}`,
        { method: 'PUT' }
      ),
  },

  expansionModules: {
    list: (customerId: number) =>
      request<ExpansionModuleListResponse>(`/vsapi/1.0.0/VsExpansionModule/List/${customerId}`),
    add: (body: AddExpansionModuleBody) =>
      request<ExpansionModule>('/vsapi/1.0.0/VsExpansionModule/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (customerId: number, moduleId: string) =>
      request<ExpansionModule>(
        `/vsapi/1.0.0/VsExpansionModule/Deactivate/${customerId}/${moduleId}`,
        { method: 'PUT' }
      ),
  },

  speedDials: {
    list: (customerId: number) =>
      request<SpeedDialListResponse>(`/vsapi/1.0.0/VsSpeedDial/List/${customerId}`),
    add: (body: AddSpeedDialBody) =>
      request<SpeedDial>('/vsapi/1.0.0/VsSpeedDial/Add', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deactivate: (customerId: number, dialId: string) =>
      request<SpeedDial>(`/vsapi/1.0.0/VsSpeedDial/Deactivate/${customerId}/${dialId}`, {
        method: 'PUT',
      }),
  },

  apiTokens: {
    list: (customerId: number) =>
      request<ApiTokenListResponse>(`/vsapi/1.0.0/VsToken/List/${customerId}`),
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

export interface ExtensionListResponse {
  extensions: Extension[]
}

/**
 * Wire shape of POST /api/v1/extensions/{id}/webphone-credential — mirrors
 * app/schemas/extension.py WebphoneCredentialResponse.
 *
 * The whole object is a secret: it carries a live SIP password. Keep it in
 * component state for as long as the phone is registered and never log it,
 * persist it, or put it in a URL.
 */
export interface WebphoneCredential {
  extension_number: string
  sip_username: string
  sip_password: string
  sip_realm: string
  ws_uri: string
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

/** Wire shape of POST /VsMessaging/Sms/Send — mirrors app/schemas/sms.py SendSmsRequest. */
export interface SendSmsBody {
  from_number: string
  to_number: string
  body: string
}

export interface SmsStatusResponse {
  success: boolean
  message_sid: string | null
  detail: string | null
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

export interface Agent {
  id: string
  customer_id: string
  extension_id: string | null
  name: string
  status: string
  active: boolean
  created_at: string
}

export interface AgentListResponse {
  agents: Agent[]
  vs_customer_id: number
}

export interface AddAgentBody {
  vs_customer_id: number
  name: string
  extension_id?: string | null
  status?: string
}

export interface CallQueue {
  id: string
  customer_id: string
  name: string
  strategy: string
  active: boolean
  created_at: string
}

export interface CallQueueListResponse {
  call_queues: CallQueue[]
  vs_customer_id: number
}

export interface AddCallQueueBody {
  vs_customer_id: number
  name: string
  strategy?: string
}

export interface AgentSkill {
  id: string
  customer_id: string
  agent_id: string
  skill: string
  level: number
  active: boolean
  created_at: string
}

export interface AgentSkillListResponse {
  agent_skills: AgentSkill[]
  vs_customer_id: number
}

export interface AddAgentSkillBody {
  vs_customer_id: number
  agent_id: string
  skill: string
  level?: number
}

export interface AudioAsset {
  id: string
  customer_id: string
  kind: string
  name: string
  s3_key: string
  playback_url: string | null
  duration_seconds: number | null
  active: boolean
  created_at: string
}

export interface AudioAssetListResponse {
  assets: AudioAsset[]
  vs_customer_id: number
}

export interface PresignedUploadBody {
  vs_customer_id: number
  name: string
  kind: string
  content_type?: string
}

export interface PresignedUploadResponse {
  upload_url: string
  s3_key: string
}

export interface ConfirmUploadBody {
  vs_customer_id: number
  name: string
  kind: string
  s3_key: string
  duration_seconds?: number | null
}

export interface VoicemailDropEvent {
  id: string
  customer_id: string
  to_number: string
  audio_asset_id: string | null
  call_sid: string | null
  status: string
  created_at: string
}

export interface VoicemailDropEventListResponse {
  events: VoicemailDropEvent[]
  vs_customer_id: number
}

export interface ExemptionCode {
  id: string
  customer_id: string
  description: string
  code: string
  call_restrictions: string
  active: boolean
  created_at: string
}

export interface ExemptionCodeListResponse {
  exemption_codes: ExemptionCode[]
  vs_customer_id: number
}

export interface AddExemptionCodeBody {
  vs_customer_id: number
  description: string
  code: string
  call_restrictions?: string
}

export interface ExpansionModule {
  id: string
  customer_id: string
  description: string
  brand: string
  model: string
  active: boolean
  created_at: string
}

export interface ExpansionModuleListResponse {
  expansion_modules: ExpansionModule[]
  vs_customer_id: number
}

export interface AddExpansionModuleBody {
  vs_customer_id: number
  description: string
  brand: string
  model: string
}

export interface SpeedDial {
  id: string
  customer_id: string
  code: string
  phone_number: string
  description: string
  active: boolean
  created_at: string
}

export interface SpeedDialListResponse {
  speed_dials: SpeedDial[]
  vs_customer_id: number
}

export interface AddSpeedDialBody {
  vs_customer_id: number
  code: string
  phone_number: string
  description?: string
}

export interface ApiTokenRow {
  token_masked: string
  enabled: boolean
}

export interface ApiTokenListResponse {
  tokens: ApiTokenRow[]
  vs_customer_id: number
}
