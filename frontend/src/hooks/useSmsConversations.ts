import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import {
  markFailed,
  mergeMessages,
  pendingMessage,
  sameConversation,
  smsSenders,
  toConversationMessage,
} from '../lib/smsConversation'
import type { SmsConversationMessage } from '../lib/smsConversation'

/**
 * How often a subscribed conversation is re-fetched. Inbound SMS lands on the
 * `sms_inbound` webhook and is persisted there; the app has no push channel to the
 * browser, so a poll is the only way an incoming message ever appears on screen.
 */
export const SMS_POLL_MS = 5000

/** Messages fetched per conversation. A bubble chain shows at most a handful of rows. */
const CONVERSATION_LIMIT = 50

export interface UseSmsConversationsResult {
  /** Live transcripts, keyed by the counterparty's E.164 number, oldest message first. */
  conversations: Readonly<Record<string, readonly SmsConversationMessage[]>>
  /** The account's outgoing number. Empty until the phone lines have loaded. */
  sender: string
  /** The last failure worth surfacing, or '' — a view may render it or ignore it. */
  error: string
  /**
   * Register interest in one conversation and get its transcript polled. Returns the
   * unsubscribe, so a caller spells the whole subscription as an effect body.
   * Reference-counted: two views watching one number share a single poll, and the
   * poll stops when the last of them goes away.
   */
  subscribe: (peer: string) => () => void
  /** Send to `peer` from the account's number, showing the message before it lands. */
  send: (peer: string, text: string) => Promise<void>
  /**
   * Peers currently composing a message, for the chain's typing dots. Always empty
   * here — SMS has no typing signal for a carrier to relay — but part of the contract
   * so the dev simulation (`useSmsSimulation`) can show one without the skin knowing
   * which source it is rendering.
   */
  typing: Readonly<Record<string, boolean>>
}

/** The one (empty) typing map the live hook ever returns, so its identity is stable. */
const NO_TYPING: Readonly<Record<string, boolean>> = {}

/**
 * Live SMS conversations, for views that render a thread rather than a table.
 *
 * This is the app's one *subscription-shaped* data hook, and the shape is what keeps it
 * honest against the skin boundary: a skin may not fetch, but it is the only layer that
 * knows which conversation a given panel is showing — on the comic-book skin that comes
 * from a wheel-picker balloon the reader turns. So the skin declares interest by number
 * and renders what comes back, and every request still happens here.
 *
 * With no subscribers it makes no requests at all, which is what lets `App` mount it for
 * every skin without the three that show no threads paying for one.
 *
 * `useSms` is the other half of the same data: the same messages as a filterable grid.
 * Both go through `api.sms`; neither knows about the other.
 */
export function useSmsConversations(): UseSmsConversationsResult {
  const [conversations, setConversations] = useState<
    Record<string, readonly SmsConversationMessage[]>
  >({})
  const [peers, setPeers] = useState<string[]>([])
  const [sender, setSender] = useState('')
  const [error, setError] = useState('')

  // How many views want each number. A ref rather than state: a second subscriber to a
  // number already being polled must not restart the interval, and only the transitions
  // at 0 change what is polled.
  const countsRef = useRef(new Map<string, number>())

  const subscribe = useCallback((peer: string) => {
    const counts = countsRef.current
    counts.set(peer, (counts.get(peer) ?? 0) + 1)
    // The identity check matters: setPeers returning the same array keeps the polling
    // effect below from tearing down and restarting on every extra subscriber.
    setPeers(prev => (prev.includes(peer) ? prev : [...prev, peer].sort()))
    return () => {
      const left = (counts.get(peer) ?? 1) - 1
      if (left > 0) {
        counts.set(peer, left)
        return
      }
      counts.delete(peer)
      setPeers(prev => (prev.includes(peer) ? prev.filter(p => p !== peer) : prev))
    }
  }, [])

  const fetchPeer = useCallback(async (peer: string) => {
    const res = await api.sms.list(DEMO_VS_CUSTOMER_ID, {
      peer,
      limit: CONVERSATION_LIMIT,
    })
    const incoming = res.messages.map(toConversationMessage)
    setConversations(prev => {
      const merged = mergeMessages(prev[peer] ?? [], incoming)
      // Hand back the previous array when nothing moved, so a quiet conversation does
      // not re-render its panel every SMS_POLL_MS.
      if (prev[peer] && sameConversation(prev[peer], merged)) return prev
      return { ...prev, [peer]: merged }
    })
  }, [])

  // One interval for every subscribed conversation. `peers` only changes identity when a
  // number is actually added or removed, so this restarts then and at no other time.
  useEffect(() => {
    if (peers.length === 0) return
    let cancelled = false

    const refresh = async () => {
      // A background tab polling a carrier API for hours is spend with nobody watching.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      for (const peer of peers) {
        try {
          await fetchPeer(peer)
          if (cancelled) return
        } catch (e) {
          if (cancelled) return
          logger.error('Failed to load an SMS conversation', { error: String(e) })
          setError('Failed to load the conversation')
        }
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), SMS_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [peers, fetchPeer])

  // The account's own number, needed only to send. Deferred until something subscribes so
  // a skin that shows no threads makes no request, and fetched once rather than per peer.
  const sendersRequested = useRef(false)
  useEffect(() => {
    if (peers.length === 0 || sendersRequested.current) return
    sendersRequested.current = true
    void (async () => {
      try {
        const lines = await api.customers.getPhoneLines(DEMO_VS_CUSTOMER_ID)
        setSender(smsSenders(lines)[0] ?? '')
      } catch (e) {
        logger.warn('Failed to load SMS-capable phone lines', { error: String(e) })
      }
    })()
  }, [peers])

  const send = useCallback(
    async (peer: string, text: string) => {
      const body = text.trim()
      if (!body) return
      if (!sender) {
        setError('No SMS-enabled number is configured for this account')
        return
      }
      // The backend rejects non-US/CA destinations with a 400 (see send_sms); say so
      // here rather than showing a failed message and a generic provider error.
      if (!peer.startsWith('+1')) {
        setError('Only +1 (US/Canada) destinations are supported')
        return
      }
      const at = new Date().toISOString()
      const pending = pendingMessage(`${peer}:${at}`, body, at)
      setConversations(prev => ({ ...prev, [peer]: [...(prev[peer] ?? []), pending] }))
      setError('')
      // Length only. Message bodies never reach the log — see the logging rule in
      // CLAUDE.md; the transcript itself is the place to read what was said.
      logger.info('Sending SMS from a conversation view', { length: body.length })
      try {
        await api.sms.send(DEMO_VS_CUSTOMER_ID, {
          from_number: sender,
          to_number: peer,
          body,
        })
        // Pull the real row straight away rather than waiting out the poll interval. The
        // pending row retires when its own message comes back (see mergeMessages), so a
        // fetch that raced the write leaves the message on screen either way.
        await fetchPeer(peer)
      } catch (e) {
        logger.error('Failed to send SMS', { error: String(e) })
        setError('Failed to send the message')
        setConversations(prev => ({
          ...prev,
          [peer]: markFailed(prev[peer] ?? [], pending.id),
        }))
      }
    },
    [sender, fetchPeer],
  )

  return { conversations, sender, error, subscribe, send, typing: NO_TYPING }
}
