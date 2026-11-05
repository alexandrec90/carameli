import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { simCallSummary, simCalls, SIM_LINE, simMessages } from '../lib/simTables'
import type { Api } from './liveClient'
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

/**
 * The demo's data layer: a typed, in-memory stand-in for the backend.
 *
 * Nothing in here touches the network. Every page keeps calling `api.*` with the shapes in
 * `types.ts`; the answers come from module state that lasts as long as the page does.
 * Calls, SMS and the CDR summary are the made-up records in `lib/simTables.ts`, the
 * account has one phone line, and every other collection starts empty. Add and Deactivate
 * work, and a reload puts everything back.
 *
 * Declared as `Api`, the live client's own type, so a live endpoint that gains or changes a
 * method fails the compiler here rather than failing a page in the demo.
 * `tests/noBackend.test.tsx` fails if anything here starts reaching for the network.
 */

const DEMO_CREATED_AT = '2026-01-01T00:00:00'

/** The one account: a fiction, so a demo dashboard has something to show. */
const DEMO_CUSTOMER: Customer = {
  id: 'demo-customer',
  vs_customer_id: DEMO_VS_CUSTOMER_ID,
  api_key: 'demo-key', // pragma: allowlist secret
  active: true,
  created_at: DEMO_CREATED_AT,
}

let recordsCreated = 0

/** The columns every stored record has, for a row that has just been added. */
function newRecord() {
  recordsCreated += 1
  return {
    id: `demo-${recordsCreated}`,
    customer_id: DEMO_CUSTOMER.id,
    active: true,
    created_at: new Date().toISOString(),
  }
}

/** One table of records. Deactivating takes a row off the list, as the real one did. */
function collection<Row extends { id: string; active: boolean }>(seed: readonly Row[] = []) {
  let rows = [...seed]
  return {
    all: (): Row[] => rows,
    add(row: Row): Row {
      rows = [...rows, row]
      return row
    },
    remove(matches: (row: Row) => boolean): Row {
      const row = rows.find(matches)
      if (!row) throw new Error('No such record')
      rows = rows.filter(other => other !== row)
      return { ...row, active: false }
    },
  }
}

const byId =
  <Row extends { id: string }>(id: string) =>
  (row: Row): boolean =>
    row.id === id

interface Period {
  start?: string
  end?: string
  limit?: number
}

/** Rows whose day falls within `start`..`end`, inclusive, capped at `limit`. */
function inPeriod<Row>(
  rows: readonly Row[],
  at: (row: Row) => string | null,
  { start, end, limit }: Period,
): Row[] {
  const within = rows.filter(row => {
    const day = (at(row) ?? '').slice(0, 10)
    return (!start || day >= start) && (!end || day <= end)
  })
  return limit ? within.slice(0, limit) : within
}

/** An uploaded file goes nowhere: an audio asset is its row and nothing else. */
const discardUpload: (uploadUrl: string, file: File) => Promise<void> = async () => undefined

const DEMO_PHONE_LINE: PhoneLine = {
  id: 'demo-line',
  customer_id: DEMO_CUSTOMER.id,
  phone_number: SIM_LINE,
  provider_sid: 'demo',
  sms_enabled: true,
  recording_enabled: false,
  active: true,
  created_at: DEMO_CREATED_AT,
}

const calls = simCalls()
let messages = simMessages()
const phoneLines = collection<PhoneLine>([DEMO_PHONE_LINE])
const extensions = collection<Extension>()
const webhooks = collection<WebhookSubscription>()
const groupExtensions = collection<GroupExtension>()
const intercomGroups = collection<IntercomGroup>()
const multicastGroups = collection<MulticastGroup>()
const conferences = collection<Conference>()
const parkingLots = collection<ParkingLot>()
const agents = collection<Agent>()
const callQueues = collection<CallQueue>()
const agentSkills = collection<AgentSkill>()
const audioAssets = collection<AudioAsset>()
const exemptionCodes = collection<ExemptionCode>()
const expansionModules = collection<ExpansionModule>()
const speedDials = collection<SpeedDial>()

export const demoApi: Api = {
  health: async (): Promise<{ status: string }> => ({ status: 'ok' }),

  signedIn: async () => true,

  customers: {
    get: async (id: number): Promise<Customer> => ({ ...DEMO_CUSTOMER, vs_customer_id: id }),
    create: async ({ vs_customer_id }: CustomerCreate): Promise<Customer> => ({
      ...DEMO_CUSTOMER,
      vs_customer_id,
    }),
    getPhoneLines: async (id: number): Promise<PhoneLine[]> =>
      id === DEMO_VS_CUSTOMER_ID ? phoneLines.all() : [],
  },

  phoneLines: {
    getCount: async (customerId: number) => ({
      count: phoneLines.all().length,
      vs_customer_id: customerId,
    }),
    add: async ({ area_code, phone_number }: AddPhoneLineBody): Promise<PhoneLine> =>
      phoneLines.add({
        ...DEMO_PHONE_LINE,
        ...newRecord(),
        phone_number:
          phone_number ?? `+1${area_code ?? '415'}555${String(1000 + recordsCreated).slice(-4)}`,
      }),
    deactivate: async (body: { vs_customer_id: number; phone_number: string }) =>
      phoneLines.remove(line => line.phone_number === body.phone_number),
  },

  extensions: {
    getAvailable: async (customerId: number, start: number, end: number) => {
      const taken = new Set(extensions.all().map(ext => ext.extension_number))
      const available = Array.from({ length: end - start + 1 }, (_, i) => String(start + i))
      return { available: available.filter(n => !taken.has(n)), vs_customer_id: customerId }
    },
    add: async ({ extension_number }: AddExtensionBody): Promise<Extension> =>
      extensions.add({
        ...newRecord(),
        extension_number,
        sip_username: `demo-${extension_number}`,
        sip_credential_sid: null,
        sip_domain_sid: null,
      }),
    list: async (): Promise<ExtensionListResponse> => ({ extensions: extensions.all() }),
    // Only the live phone asks: the demo's registers as nothing, so it needs no password.
    webphoneCredential: async (): Promise<WebphoneCredential> => {
      throw new Error('A demo extension has no SIP credential')
    },
  },

  calls: {
    list: async (customerId: number, period: Period = {}): Promise<CallEventListResponse> => ({
      events: inPeriod(calls, call => call.started_at, period),
      vs_customer_id: customerId,
    }),
    summary: async (
      customerId: number,
      { groupBy = 'extension' }: { groupBy?: CallSummaryGroupBy; start?: string; end?: string } = {},
    ): Promise<CallSummaryResponse> => ({
      summary: simCallSummary(groupBy),
      group_by: groupBy,
      vs_customer_id: customerId,
    }),
  },

  webhooks: {
    list: async (customerId: number): Promise<WebhookSubscriptionListResponse> => ({
      subscriptions: webhooks.all(),
      vs_customer_id: customerId,
    }),
    add: async (body: AddWebhookSubscriptionBody): Promise<WebhookSubscription> =>
      webhooks.add({ ...newRecord(), description: '', enabled: true, ...body }),
    deactivate: async (_customerId: number, id: string): Promise<WebhookSubscription> =>
      webhooks.remove(byId(id)),
  },

  sms: {
    list: async (customerId: number, period: Period = {}): Promise<SmsMessageListResponse> => ({
      messages: inPeriod(messages, message => message.created_at, period),
      vs_customer_id: customerId,
    }),
    send: async (_customerId: number, body: SendSmsBody): Promise<SmsStatusResponse> => {
      const { id, created_at } = newRecord()
      messages = [
        {
          ...body,
          id,
          created_at,
          direction: 'outbound',
          message_sid: id,
          delivery_status: 'delivered',
          error_code: null,
        },
        ...messages,
      ]
      return { success: true, message_sid: id, detail: null }
    },
  },

  groupExtensions: {
    list: async (customerId: number): Promise<GroupExtensionListResponse> => ({
      group_extensions: groupExtensions.all(),
      vs_customer_id: customerId,
    }),
    add: async (body: AddGroupExtensionBody): Promise<GroupExtension> =>
      groupExtensions.add({ ...newRecord(), description: '', ...body }),
    deactivate: async (_customerId: number, id: string): Promise<GroupExtension> =>
      groupExtensions.remove(byId(id)),
  },

  intercomGroups: {
    list: async (customerId: number): Promise<IntercomGroupListResponse> => ({
      intercom_groups: intercomGroups.all(),
      vs_customer_id: customerId,
    }),
    add: async (body: AddIntercomGroupBody): Promise<IntercomGroup> =>
      intercomGroups.add({
        ...newRecord(),
        description: '',
        bidirectional_audio: false,
        expiry: null,
        ...body,
      }),
    deactivate: async (_customerId: number, id: string): Promise<IntercomGroup> =>
      intercomGroups.remove(byId(id)),
  },

  multicastGroups: {
    list: async (customerId: number): Promise<MulticastGroupListResponse> => ({
      multicast_groups: multicastGroups.all(),
      vs_customer_id: customerId,
    }),
    add: async (body: AddMulticastGroupBody): Promise<MulticastGroup> =>
      multicastGroups.add({ ...newRecord(), description: '', ...body }),
    deactivate: async (_customerId: number, id: string): Promise<MulticastGroup> =>
      multicastGroups.remove(byId(id)),
  },

  conferences: {
    list: async (customerId: number): Promise<ConferenceListResponse> => ({
      conferences: conferences.all(),
      vs_customer_id: customerId,
    }),
    add: async (body: AddConferenceBody): Promise<Conference> =>
      conferences.add({
        ...newRecord(),
        description: '',
        max_participants: 10,
        recorded_calls: false,
        ...body,
      }),
    deactivate: async (_customerId: number, id: string): Promise<Conference> =>
      conferences.remove(byId(id)),
  },

  parkingLots: {
    list: async (customerId: number): Promise<ParkingLotListResponse> => ({
      parking_lots: parkingLots.all(),
      vs_customer_id: customerId,
    }),
    add: async (body: AddParkingLotBody): Promise<ParkingLot> =>
      parkingLots.add({ ...newRecord(), description: '', ring_back_time_limit: 60, ...body }),
    deactivate: async (_customerId: number, id: string): Promise<ParkingLot> =>
      parkingLots.remove(byId(id)),
  },

  agents: {
    list: async (customerId: number): Promise<AgentListResponse> => ({
      agents: agents.all(),
      vs_customer_id: customerId,
    }),
    add: async (body: AddAgentBody): Promise<Agent> =>
      agents.add({ ...newRecord(), extension_id: null, status: 'available', ...body }),
    deactivate: async (_customerId: number, id: string): Promise<Agent> =>
      agents.remove(byId(id)),
  },

  callQueues: {
    list: async (customerId: number): Promise<CallQueueListResponse> => ({
      call_queues: callQueues.all(),
      vs_customer_id: customerId,
    }),
    add: async (body: AddCallQueueBody): Promise<CallQueue> =>
      callQueues.add({ ...newRecord(), strategy: 'round-robin', ...body }),
    deactivate: async (_customerId: number, id: string): Promise<CallQueue> =>
      callQueues.remove(byId(id)),
  },

  agentSkills: {
    list: async (customerId: number): Promise<AgentSkillListResponse> => ({
      agent_skills: agentSkills.all(),
      vs_customer_id: customerId,
    }),
    add: async (body: AddAgentSkillBody): Promise<AgentSkill> =>
      agentSkills.add({ ...newRecord(), level: 1, ...body }),
    deactivate: async (_customerId: number, id: string): Promise<AgentSkill> =>
      agentSkills.remove(byId(id)),
  },

  audioAssets: {
    list: async (customerId: number, kind?: string): Promise<AudioAssetListResponse> => ({
      assets: audioAssets.all().filter(asset => !kind || asset.kind === kind),
      vs_customer_id: customerId,
    }),
    presignedUpload: async ({ name }: PresignedUploadBody): Promise<PresignedUploadResponse> => ({
      upload_url: '',
      s3_key: `demo/${name}`,
    }),
    uploadToS3: discardUpload,
    confirmUpload: async (body: ConfirmUploadBody): Promise<AudioAsset> =>
      audioAssets.add({ ...newRecord(), playback_url: null, duration_seconds: null, ...body }),
    deactivate: async (_customerId: number, id: string): Promise<AudioAsset> =>
      audioAssets.remove(byId(id)),
  },

  voicemailDropEvents: {
    list: async (customerId: number): Promise<VoicemailDropEventListResponse> => ({
      events: [],
      vs_customer_id: customerId,
    }),
  },

  exemptionCodes: {
    list: async (customerId: number): Promise<ExemptionCodeListResponse> => ({
      exemption_codes: exemptionCodes.all(),
      vs_customer_id: customerId,
    }),
    add: async (body: AddExemptionCodeBody): Promise<ExemptionCode> =>
      exemptionCodes.add({ ...newRecord(), call_restrictions: '', ...body }),
    deactivate: async (_customerId: number, id: string): Promise<ExemptionCode> =>
      exemptionCodes.remove(byId(id)),
  },

  expansionModules: {
    list: async (customerId: number): Promise<ExpansionModuleListResponse> => ({
      expansion_modules: expansionModules.all(),
      vs_customer_id: customerId,
    }),
    add: async (body: AddExpansionModuleBody): Promise<ExpansionModule> =>
      expansionModules.add({ ...newRecord(), ...body }),
    deactivate: async (_customerId: number, id: string): Promise<ExpansionModule> =>
      expansionModules.remove(byId(id)),
  },

  speedDials: {
    list: async (customerId: number): Promise<SpeedDialListResponse> => ({
      speed_dials: speedDials.all(),
      vs_customer_id: customerId,
    }),
    add: async (body: AddSpeedDialBody): Promise<SpeedDial> =>
      speedDials.add({ ...newRecord(), description: '', ...body }),
    deactivate: async (_customerId: number, id: string): Promise<SpeedDial> =>
      speedDials.remove(byId(id)),
  },

  apiTokens: {
    list: async (customerId: number): Promise<ApiTokenListResponse> => ({
      tokens: [{ token_masked: 'demo-••••', enabled: true }],
      vs_customer_id: customerId,
    }),
  },
}
