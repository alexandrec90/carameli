import {
  isBackendOffline,
  isUnreachableStatus,
  markBackendOffline,
} from '../lib/backendReachability'
import { logger } from '../lib/logger'
import type {
  AddAgentBody,
  AddAgentSkillBody,
  AddCallQueueBody,
  AddConferenceBody,
  AddExemptionCodeBody,
  AddExpansionModuleBody,
  AddExtensionBody,
  AddGroupExtensionBody,
  AddIntercomGroupBody,
  AddMulticastGroupBody,
  AddParkingLotBody,
  AddPhoneLineBody,
  AddSpeedDialBody,
  AddWebhookSubscriptionBody,
  Agent,
  AgentListResponse,
  AgentSkill,
  AgentSkillListResponse,
  ApiTokenListResponse,
  AudioAsset,
  AudioAssetListResponse,
  CallEventListResponse,
  CallQueue,
  CallQueueListResponse,
  CallSummaryGroupBy,
  CallSummaryResponse,
  Conference,
  ConferenceListResponse,
  ConfirmUploadBody,
  Customer,
  CustomerCreate,
  ExemptionCode,
  ExemptionCodeListResponse,
  ExpansionModule,
  ExpansionModuleListResponse,
  Extension,
  ExtensionListResponse,
  GroupExtension,
  GroupExtensionListResponse,
  IntercomGroup,
  IntercomGroupListResponse,
  MulticastGroup,
  MulticastGroupListResponse,
  ParkingLot,
  ParkingLotListResponse,
  PhoneLine,
  PresignedUploadBody,
  PresignedUploadResponse,
  SendSmsBody,
  SmsMessageListResponse,
  SmsStatusResponse,
  SpeedDial,
  SpeedDialListResponse,
  VoicemailDropEventListResponse,
  WebhookSubscription,
  WebhookSubscriptionListResponse,
  WebphoneCredential,
} from './types'

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

/** What `api` looks like. The demo client is declared as this, so the two cannot drift. */
export type Api = typeof liveApi

/** The real backend, over `fetch`. `api/client.ts` hands this out only in a live build. */
export const liveApi = {
  health: () => request<{ status: string }>('/health'),

  /** Whether there is a session. A plain probe: having none is an answer, not a failure. */
  signedIn: async () => (await fetch('/auth/me', { credentials: 'include' })).ok,

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
