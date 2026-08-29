import type { PhoneLine, SmsMessage } from '../api/client'

// The pure half of a live SMS conversation: the shape a view renders, how a wire row
// becomes one, and how a freshly polled page folds into what is already on screen.
// Kept out of the hook so the reconciliation rules below â€” which are the only place an
// optimistic send can double a message or lose one â€” are testable without a fetch.

/** Where a message is on its way to the carrier. */
export type SmsSendStatus = 'sent' | 'sending' | 'failed'

/**
 * One message in a conversation, in the shape a view renders: which side it is on,
 * what it says, and whether it has actually left the building yet.
 *
 * `id` is the server row's UUID for a message that exists and a `pending:`-prefixed
 * local key for one that has been typed but not yet acknowledged. Merging is by id,
 * which is what lets a poll landing mid-send replace a row rather than double it.
 */
export interface SmsConversationMessage {
  id: string
  text: string
  /** True for a message this account sent â€” the sender's column of a bubble chain. */
  outbound: boolean
  /** ISO-8601, as the API returns it. Sorting is lexical, which is correct for ISO. */
  at: string
  status: SmsSendStatus
}

/** The prefix that marks a local, not-yet-acknowledged row. */
const PENDING_PREFIX = 'pending:'

export function isPending(m: SmsConversationMessage): boolean {
  return m.id.startsWith(PENDING_PREFIX)
}

/** A row typed into a composer, shown immediately and reconciled by the next poll. */
export function pendingMessage(key: string, text: string, at: string): SmsConversationMessage {
  return { id: `${PENDING_PREFIX}${key}`, text, outbound: true, at, status: 'sending' }
}

/**
 * Whether a carrier delivery status says the message never got there. Telnyx reports
 * the outcome in a `message.finalized` receipt and the webhook stores it verbatim:
 * `sending_failed` (rejected before it left) and `delivery_failed` (bounced by the far
 * carrier) are the two failures; everything else — `queued`, `sending`, `sent`,
 * `delivered`, `delivery_unconfirmed` — is a message on its way or arrived.
 */
function isDeliveryFailure(deliveryStatus: string | null | undefined): boolean {
  return (deliveryStatus ?? '').endsWith('_failed')
}

/**
 * Map the wire row onto the render shape. Direction decides the column, not the number,
 * and a receipt that says the carrier gave up marks the row failed, so a real thread
 * shows a bounced message the same way it shows one the API refused.
 */
export function toConversationMessage(m: SmsMessage): SmsConversationMessage {
  return {
    id: m.id,
    text: m.body ?? '',
    outbound: m.direction === 'outbound',
    at: m.created_at,
    status: isDeliveryFailure(m.delivery_status) ? 'failed' : 'sent',
  }
}

/**
 * Fold a freshly fetched page into the conversation already on screen, oldest first.
 *
 * Two rules, and both exist because a poll and a send race by design:
 *
 * - **Server rows win by id.** A row fetched twice is one row, so a poll overlapping
 *   the previous one cannot duplicate anything.
 * - **A pending row retires when its own message comes back.** The server assigns an
 *   id the client could not predict, so identity is the only thing they share:
 *   same text, same side, and a timestamp no earlier than the moment it was typed.
 *   Dropping pending rows unconditionally on a successful POST would blank the message
 *   for however long the next fetch takes; keeping them until a matching row arrives
 *   costs nothing and survives a fetch that missed the write.
 */
export function mergeMessages(
  prev: readonly SmsConversationMessage[],
  incoming: readonly SmsConversationMessage[],
): SmsConversationMessage[] {
  const byId = new Map<string, SmsConversationMessage>()
  for (const m of prev) byId.set(m.id, m)
  for (const m of incoming) byId.set(m.id, m)

  const server = [...byId.values()].filter(m => !isPending(m))
  const pending = [...byId.values()].filter(isPending).filter(
    p => !server.some(s => s.outbound && s.text === p.text && s.at >= p.at),
  )

  return [...server, ...pending].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/**
 * Whether two merge results say the same thing. A poll returns a fresh array every
 * time, so without this every subscribed conversation would hand its consumer a new
 * identity every few seconds and re-render a page that has not changed — which on the
 * comic-book skin means repainting panels behind a hover animation.
 */
export function sameConversation(
  a: readonly SmsConversationMessage[],
  b: readonly SmsConversationMessage[],
): boolean {
  if (a.length !== b.length) return false
  return a.every((m, i) => m.id === b[i].id && m.status === b[i].status && m.text === b[i].text)
}

/** Mark one message failed, leaving the rest of the conversation alone. */
export function markFailed(
  messages: readonly SmsConversationMessage[],
  id: string,
): SmsConversationMessage[] {
  return messages.map(m => (m.id === id ? { ...m, status: 'failed' as const } : m))
}

/**
 * The account's SMS-capable numbers, newest-registered order preserved. Shared by every
 * hook that needs a `from_number`, so the two rules that make a line usable â€” it is
 * active, and SMS is switched on for it â€” are stated once.
 */
export function smsSenders(lines: readonly PhoneLine[]): string[] {
  return lines.filter(l => l.active && l.sms_enabled).map(l => l.phone_number)
}
