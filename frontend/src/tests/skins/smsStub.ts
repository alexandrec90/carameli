import { vi } from 'vitest'

import type { UseSmsConversationsResult } from '../../hooks/useSmsConversations'
import type { SmsConversationMessage } from '../../lib/smsConversation'

/**
 * A `useSmsConversations` result that does nothing, for the many component tests that
 * render a panel and have no interest in SMS at all.
 *
 * A stub rather than the real hook because the real one is the only thing in the skin tree
 * that makes requests: rendering a panel with it would put every one of those tests on a
 * five-second poll against a mocked fetch, which is how a suite starts failing for reasons
 * that have nothing to do with what it asserts.
 */
export function idleSms(over: Partial<UseSmsConversationsResult> = {}): UseSmsConversationsResult {
  return {
    conversations: {},
    sender: '',
    error: '',
    subscribe: vi.fn(() => () => undefined),
    send: vi.fn(async () => undefined),
    ...over,
  }
}

/** One transcript row, defaulted to a received message that has landed. */
export function smsMessage(
  over: Partial<SmsConversationMessage> = {},
): SmsConversationMessage {
  return {
    id: 'm1',
    text: 'hello',
    outbound: false,
    at: '2026-08-26T12:00:00Z',
    status: 'sent',
    ...over,
  }
}
