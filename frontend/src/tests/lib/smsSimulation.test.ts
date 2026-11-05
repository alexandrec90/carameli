import { describe, expect, it } from 'vitest'

import {
  SIM_REPLIES,
  SIM_REPLY_CHANCE,
  simReply,
} from '../../lib/smsSimulation'

/** An rng that replays `values` in order — how a test decides the coin and the pick. */
const seeded = (...values: number[]) => {
  let i = 0
  return () => values[i++] ?? 0
}

describe('simReply', () => {
  it('stays silent when the coin lands at or above the chance', () => {
    expect(simReply(seeded(SIM_REPLY_CHANCE))).toBeNull()
    expect(simReply(seeded(0.999))).toBeNull()
  })

  it('answers from the pool when the coin lands under it', () => {
    expect(simReply(seeded(0.1, 0))).toBe(SIM_REPLIES[0])
    expect(simReply(seeded(0.1, 0.999))).toBe(SIM_REPLIES[SIM_REPLIES.length - 1])
  })

  it('spends the coin before the pick, so one rng decides both', () => {
    // The same second draw with a losing coin never reaches the pool.
    expect(simReply(seeded(0.7, 0))).toBeNull()
  })
})
