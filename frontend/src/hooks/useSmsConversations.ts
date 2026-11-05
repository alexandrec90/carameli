import { useDemoSmsConversations } from './useDemoSmsConversations'
import { useLiveSmsConversations } from './useLiveSmsConversations'

export type { UseSmsConversationsResult } from '../lib/smsConversation'

/** SMS threads: canned replies by default, the real messages in a live build. */
export const useSmsConversations =
  import.meta.env.VITE_LIVE_BACKEND === 'true' ? useLiveSmsConversations : useDemoSmsConversations
