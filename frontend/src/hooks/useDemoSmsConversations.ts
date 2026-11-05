import { useCallback, useEffect, useRef, useState } from 'react'

import type { SmsConversationMessage, UseSmsConversationsResult } from '../lib/smsConversation'
import { SIM_SENDER, SIM_TYPING_DELAY_MS, SIM_TYPING_MS, simReply } from '../lib/smsSimulation'

/**
 * SMS conversations for views that render a thread rather than a table, with nobody on
 * the other end.
 *
 * Transcripts are keyed by peer and kept for the life of the page, which is what lets the
 * wheel move to another number and come back to the conversation it left. `send` appends
 * locally, and the peer answers a coin flip ({@link SIM_REPLY_CHANCE}) of them: a pause,
 * then the typing dots ({@link SIM_TYPING_DELAY_MS}), then a canned reply
 * ({@link SIM_TYPING_MS} later). The timers run per send, against whichever peer was
 * written to, so a reply still lands in its own thread when the reader has already
 * turned the wheel elsewhere.
 */
export function useDemoSmsConversations(): UseSmsConversationsResult {
  const [conversations, setConversations] = useState<
    Record<string, readonly SmsConversationMessage[]>
  >({})
  const [typing, setTyping] = useState<Record<string, boolean>>({})
  // Message ids: unique is all they need to be, and a counter says which send was which.
  const seqRef = useRef(0)
  const timersRef = useRef(new Set<number>())

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const t of timers) window.clearTimeout(t)
    }
  }, [])

  // There is no server to poll, so interest costs nothing to register.
  const subscribe = useCallback(() => () => undefined, [])

  const send = useCallback(async (peer: string, text: string) => {
    const body = text.trim()
    if (!body) return
    const append = (m: SmsConversationMessage): void =>
      setConversations(prev => ({ ...prev, [peer]: [...(prev[peer] ?? []), m] }))
    seqRef.current += 1
    append({
      id: `sim:${seqRef.current}`,
      text: body,
      outbound: true,
      at: new Date().toISOString(),
      status: 'sent',
    })

    const reply = simReply(Math.random)
    if (reply === null) return
    const later = (ms: number, run: () => void): void => {
      const t = window.setTimeout(() => {
        timersRef.current.delete(t)
        run()
      }, ms)
      timersRef.current.add(t)
    }
    later(SIM_TYPING_DELAY_MS, () => {
      setTyping(prev => ({ ...prev, [peer]: true }))
      later(SIM_TYPING_MS, () => {
        setTyping(prev => ({ ...prev, [peer]: false }))
        seqRef.current += 1
        append({
          id: `sim:${seqRef.current}`,
          text: reply,
          outbound: false,
          at: new Date().toISOString(),
          status: 'sent',
        })
      })
    })
  }, [])

  return { conversations, typing, sender: SIM_SENDER, error: '', subscribe, send }
}
