import { describe, expect, it } from 'vitest'

import {
  WHEEL_ROW_EM,
  WHEEL_STEP_DELTA,
  clampIndex,
  isBubbleContentKind,
  splitOptions,
  wheelOffsetEm,
  wheelSteps,
} from '../../skins/comic-book/wheelPicker'

describe('splitOptions', () => {
  it('splits comma-delimited text into trimmed options', () => {
    expect(splitOptions('One, Two ,Three')).toEqual(['One', 'Two', 'Three'])
  })

  // Authors type trailing commas and double commas while editing; neither should
  // put a blank row on the wheel.
  it('drops empty entries', () => {
    expect(splitOptions('One,, Two,')).toEqual(['One', 'Two'])
    expect(splitOptions('')).toEqual([])
    expect(splitOptions(' , ,')).toEqual([])
  })

  it('treats text with no comma as a single option', () => {
    expect(splitOptions('Just the one')).toEqual(['Just the one'])
  })
})

describe('clampIndex', () => {
  it('clamps to the ends rather than wrapping', () => {
    expect(clampIndex(-3, 4)).toBe(0)
    expect(clampIndex(9, 4)).toBe(3)
    expect(clampIndex(2, 4)).toBe(2)
  })

  it('returns -1 when there is nothing to select', () => {
    expect(clampIndex(0, 0)).toBe(-1)
  })
})

describe('wheelSteps', () => {
  it('turns one notch of a stepped mouse wheel into one step', () => {
    // Chromium reports ~100px of deltaY per notch of a discrete wheel — past one
    // step threshold but not two.
    expect(wheelSteps(0, 100)).toEqual({ acc: 100 - WHEEL_STEP_DELTA, steps: 1 })
    expect(wheelSteps(0, -100)).toEqual({ acc: -(100 - WHEEL_STEP_DELTA), steps: -1 })
  })

  it('accumulates small trackpad deltas until they add up to a step', () => {
    // Trackpads report a stream of small deltas; a threshold without an
    // accumulator would never fire on them.
    let acc = 0
    let total = 0
    for (let i = 0; i < 6; i++) {
      const r = wheelSteps(acc, 12)
      acc = r.acc
      total += r.steps
    }
    expect(total).toBe(1) // 6 × 12 = 72 → one 60-px step, 12 px carried
    expect(acc).toBe(72 - WHEEL_STEP_DELTA)
  })

  it('carries the remainder forward rather than discarding it', () => {
    const r = wheelSteps(50, 130) // 180 total → 3 steps of 60, nothing left
    expect(r.steps).toBe(3)
    expect(r.acc).toBe(0)
  })

  it('lets a direction reversal drain the accumulator first', () => {
    const r = wheelSteps(40, -50)
    expect(r.steps).toBe(0)
    expect(r.acc).toBe(-10)
  })
})

describe('wheelOffsetEm', () => {
  // The track is anchored at the window's vertical centre; each row is
  // WHEEL_ROW_EM tall, so centring row i means lifting the track by i rows
  // plus half a row.
  it('centres the selected row in the window', () => {
    expect(wheelOffsetEm(0)).toBe(-0.5 * WHEEL_ROW_EM)
    expect(wheelOffsetEm(2)).toBe(-2.5 * WHEEL_ROW_EM)
  })
})

describe('isBubbleContentKind', () => {
  it('accepts the two kinds and nothing else', () => {
    expect(isBubbleContentKind('text')).toBe(true)
    expect(isBubbleContentKind('wheel')).toBe(true)
    expect(isBubbleContentKind('spinner')).toBe(false)
    expect(isBubbleContentKind(undefined)).toBe(false)
    expect(isBubbleContentKind(1)).toBe(false)
  })
})
