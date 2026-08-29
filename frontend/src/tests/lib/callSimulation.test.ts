import { afterEach, describe, expect, it } from 'vitest'

import {
  detectCallSim,
  SIM_FILLERS,
  SIM_GAP_MAX_MS,
  SIM_GAP_MIN_MS,
  SIM_MAX_LINES,
  SIM_MS_PER_CHAR,
  SIM_SCRIPT,
  SIM_SPEAK_MIN_MS,
  simGapMs,
  simLineAt,
  speakMs,
} from '../../lib/callSimulation'
import { EMPTY_TRANSCRIPT, linesBy } from '../../lib/callTranscript'
import type { CallTranscript } from '../../lib/callTranscript'

/** An rng that hands out `values` in order, then the last one forever. */
const seeded = (...values: number[]) => {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

describe('simLineAt', () => {
  it('reads the script in order, needing nothing from the rng', () => {
    const rng = () => {
      throw new Error('the script is not random')
    }
    SIM_SCRIPT.forEach((line, i) => expect(simLineAt(i, rng)).toEqual(line))
  })

  it('opens with the far end answering and alternates from there', () => {
    // A call starts with "Hello?" from whoever picked up; the caller then speaks. The
    // scene's two halves light in turn only because the script actually alternates.
    expect(SIM_SCRIPT[0].speaker).toBe('remote')
    SIM_SCRIPT.slice(1).forEach((line, i) => expect(line.speaker).not.toBe(SIM_SCRIPT[i].speaker))
  })

  it('draws a filler past the script: speaker first, then the line', () => {
    const after = SIM_SCRIPT.length
    expect(simLineAt(after, seeded(0.2, 0))).toEqual({ speaker: 'local', text: SIM_FILLERS.local[0] })
    const last = SIM_FILLERS.remote.length - 1
    expect(simLineAt(after, seeded(0.9, 0.999))).toEqual({
      speaker: 'remote',
      text: SIM_FILLERS.remote[last],
    })
    // An rng that returns exactly 1 would index past the pool; it is clamped instead.
    expect(simLineAt(after, seeded(0.9, 1))?.text).toBe(SIM_FILLERS.remote[last])
  })

  it('falls silent at the cap', () => {
    expect(simLineAt(SIM_MAX_LINES - 1, seeded(0))).not.toBeNull()
    expect(simLineAt(SIM_MAX_LINES, seeded(0))).toBeNull()
    expect(SIM_MAX_LINES).toBeGreaterThan(SIM_SCRIPT.length)
  })
})

describe('simGapMs', () => {
  it('spans the range: the shortest silence at 0, just under the longest near 1', () => {
    expect(simGapMs(() => 0)).toBe(SIM_GAP_MIN_MS)
    expect(simGapMs(() => 0.999999)).toBeLessThan(SIM_GAP_MAX_MS)
    expect(simGapMs(() => 0.999999)).toBeGreaterThan(SIM_GAP_MIN_MS)
    expect(simGapMs(() => 0.5)).toBe((SIM_GAP_MIN_MS + SIM_GAP_MAX_MS) / 2)
  })
})

describe('speakMs', () => {
  it('holds a short line for the floor and a long one for its length', () => {
    expect(speakMs('Hi.')).toBe(SIM_SPEAK_MIN_MS)
    const long = 'x'.repeat(100)
    expect(speakMs(long)).toBe(100 * SIM_MS_PER_CHAR)
    expect(speakMs(long)).toBeGreaterThan(SIM_SPEAK_MIN_MS)
  })
})

describe('linesBy', () => {
  it('hands each balloon its own party, in order, and nothing from an empty call', () => {
    const transcript: CallTranscript = {
      lines: [
        { id: 'a', speaker: 'remote', text: 'Hello?' },
        { id: 'b', speaker: 'local', text: 'Where are you?' },
        { id: 'c', speaker: 'remote', text: 'The office.' },
      ],
      speaking: 'remote',
    }
    expect(linesBy(transcript, 'remote').map(l => l.id)).toEqual(['a', 'c'])
    expect(linesBy(transcript, 'local').map(l => l.id)).toEqual(['b'])
    expect(linesBy(EMPTY_TRANSCRIPT, 'local')).toEqual([])
  })
})

describe('detectCallSim', () => {
  const FLAG = 'call:sim'
  const visit = (search: string) => window.history.replaceState(null, '', `/${search}`)

  afterEach(() => {
    visit('')
    window.localStorage.removeItem(FLAG)
  })

  it('is off with nothing asked for and nothing remembered', () => {
    expect(detectCallSim()).toBe(false)
    expect(window.localStorage.getItem(FLAG)).toBeNull()
  })

  it('turns on from ?callSim=1 and remembers it for the next page', () => {
    visit('?callSim=1')
    expect(detectCallSim()).toBe(true)
    expect(window.localStorage.getItem(FLAG)).toBe('1')

    visit('')
    expect(detectCallSim()).toBe(true)
  })

  it('turns off from ?callSim=0 and forgets', () => {
    window.localStorage.setItem(FLAG, '1')
    visit('?callSim=0')
    expect(detectCallSim()).toBe(false)
    expect(window.localStorage.getItem(FLAG)).toBeNull()
  })

  it('keeps its own flag apart from the SMS one', () => {
    visit('?smsSim=1')
    expect(detectCallSim()).toBe(false)
    expect(window.localStorage.getItem(FLAG)).toBeNull()
  })
})
