import { describe, expect, it } from 'vitest'

import type { PhoneLine, SmsMessage } from '../../api/client'
import {
  isPending,
  markFailed,
  mergeMessages,
  pendingMessage,
  sameConversation,
  smsSenders,
  toConversationMessage,
} from '../../lib/smsConversation'
import type { SmsConversationMessage } from '../../lib/smsConversation'

function wire(over: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: 'id-1',
    direction: 'outbound',
    from_number: '+14155550000',
    to_number: '+14155551111',
    body: 'hi',
    message_sid: 'SM1',
    delivery_status: 'delivered',
    error_code: null,
    created_at: '2026-08-26T12:00:00Z',
    ...over,
  }
}

function msg(over: Partial<SmsConversationMessage> = {}): SmsConversationMessage {
  return { id: 'a', text: 'hi', outbound: false, at: '2026-08-26T12:00:00Z', status: 'sent', ...over }
}

function line(over: Partial<PhoneLine> = {}): PhoneLine {
  return {
    id: 'line-1',
    customer_id: 'cust-1',
    phone_number: '+14155550000',
    provider_sid: 'prov-1',
    sms_enabled: true,
    recording_enabled: false,
    active: true,
    created_at: '2026-08-01T00:00:00Z',
    ...over,
  }
}

describe('toConversationMessage', () => {
  it('puts an outbound message on the sender’s side', () => {
    expect(toConversationMessage(wire({ direction: 'outbound' })).outbound).toBe(true)
  })

  it('puts an inbound message on the recipient’s side', () => {
    expect(toConversationMessage(wire({ direction: 'inbound' })).outbound).toBe(false)
  })

  it('renders a message with no body as an empty balloon rather than crashing', () => {
    expect(toConversationMessage(wire({ body: null as unknown as string })).text).toBe('')
  })
})

describe('mergeMessages', () => {
  it('orders the result by timestamp, oldest first', () => {
    const merged = mergeMessages([], [
      msg({ id: 'b', at: '2026-08-26T12:00:02Z' }),
      msg({ id: 'a', at: '2026-08-26T12:00:01Z' }),
    ])
    expect(merged.map(m => m.id)).toEqual(['a', 'b'])
  })

  it('takes the server’s copy of a message it already had, by id', () => {
    const prev = [msg({ id: 'a', text: 'old' })]
    const merged = mergeMessages(prev, [msg({ id: 'a', text: 'new' })])
    expect(merged).toHaveLength(1)
    expect(merged[0].text).toBe('new')
  })

  it('keeps a pending message the server has not acknowledged yet', () => {
    const pending = pendingMessage('k', 'on its way', '2026-08-26T12:00:05Z')
    const merged = mergeMessages([pending], [msg({ id: 'a', at: '2026-08-26T12:00:00Z' })])
    expect(merged.map(m => m.text)).toEqual(['hi', 'on its way'])
    expect(isPending(merged[1])).toBe(true)
  })

  it('retires a pending message once its own row comes back', () => {
    // The whole point of the optimistic send: the balloon must not be drawn twice the
    // moment the poll catches up with it.
    const pending = pendingMessage('k', 'sent it', '2026-08-26T12:00:05Z')
    const merged = mergeMessages([pending], [
      msg({ id: 'srv', text: 'sent it', outbound: true, at: '2026-08-26T12:00:06Z' }),
    ])
    expect(merged).toHaveLength(1)
    expect(isPending(merged[0])).toBe(false)
  })

  it('does not retire a pending message against an older row with the same text', () => {
    // Sending the same words twice is ordinary. An earlier identical message must not
    // swallow the new one, which is why the timestamp comparison is there.
    const pending = pendingMessage('k', 'ok', '2026-08-26T12:00:05Z')
    const merged = mergeMessages([pending], [
      msg({ id: 'srv', text: 'ok', outbound: true, at: '2026-08-26T11:00:00Z' }),
    ])
    expect(merged).toHaveLength(2)
  })

  it('does not retire a pending message against an inbound row that echoes it', () => {
    const pending = pendingMessage('k', 'ok', '2026-08-26T12:00:05Z')
    const merged = mergeMessages([pending], [
      msg({ id: 'srv', text: 'ok', outbound: false, at: '2026-08-26T12:00:06Z' }),
    ])
    expect(merged).toHaveLength(2)
  })
})

describe('sameConversation', () => {
  it('is true for two reads of an unchanged transcript', () => {
    expect(sameConversation([msg()], [msg()])).toBe(true)
  })

  it('is false when a message arrives', () => {
    expect(sameConversation([msg()], [msg(), msg({ id: 'b' })])).toBe(false)
  })

  it('is false when only the delivery state moved', () => {
    // Status is what a pending balloon renders, so a change in it has to re-render.
    expect(sameConversation([msg()], [msg({ status: 'failed' })])).toBe(false)
  })

  it('is false when only the text changed', () => {
    expect(sameConversation([msg()], [msg({ text: 'other' })])).toBe(false)
  })
})

describe('markFailed', () => {
  it('marks the named message and leaves the rest alone', () => {
    const out = markFailed([msg({ id: 'a' }), msg({ id: 'b' })], 'b')
    expect(out.map(m => m.status)).toEqual(['sent', 'failed'])
  })

  it('is a no-op for an id that is not there', () => {
    const before = [msg({ id: 'a' })]
    expect(markFailed(before, 'nope').map(m => m.status)).toEqual(['sent'])
  })
})

describe('smsSenders', () => {
  it('keeps only active, SMS-enabled lines', () => {
    const lines = [
      line({ phone_number: '+1', sms_enabled: true, active: true }),
      line({ phone_number: '+2', sms_enabled: false, active: true }),
      line({ phone_number: '+3', sms_enabled: true, active: false }),
    ]
    expect(smsSenders(lines)).toEqual(['+1'])
  })
})
