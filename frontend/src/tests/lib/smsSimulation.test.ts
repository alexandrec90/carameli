import { describe, expect, it } from 'vitest'

import {
  resolveSimFlag,
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

describe('resolveSimFlag', () => {
  it('turns on with ?smsSim=1 and persists', () => {
    expect(resolveSimFlag('1', null)).toEqual({ active: true, storedFlag: '1' })
  })

  it('turns off with ?smsSim=0 and clears the stored flag', () => {
    expect(resolveSimFlag('0', '1')).toEqual({ active: false, storedFlag: null })
  })

  it('lets the stored flag decide when the query says nothing', () => {
    expect(resolveSimFlag(null, '1')).toEqual({ active: true, storedFlag: '1' })
    expect(resolveSimFlag(null, null)).toEqual({ active: false, storedFlag: null })
  })

  it('discards an unrecognized stored value', () => {
    expect(resolveSimFlag(null, 'yes')).toEqual({ active: false, storedFlag: null })
  })

  it('ignores an unrecognized query value', () => {
    expect(resolveSimFlag('2', '1')).toEqual({ active: true, storedFlag: '1' })
  })
})
