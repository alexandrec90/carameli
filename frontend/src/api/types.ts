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
