import { describe, expect, it } from 'vitest'

import {
  chainIds,
  chainIdsOn,
  chainSlots,
  chainTranscript,
  clampHead,
  defaultChain,
  growTarget,
  isBubbleChain,
  stepHead,
  visibleWindow,
} from '../../skins/comic-book/bubbleChain'
import type { BubbleChain } from '../../skins/comic-book/bubbleChain'

const member = (chain: string, panel: number, top: number) => ({ chain, panel, top })

const chain = (over: Partial<BubbleChain> = {}): BubbleChain => ({
  id: 'left',
  grow: true,
  scroll: true,
  stepMs: 900,
  messages: [],
  ...over,
})

describe('chainSlots', () => {
  it('orders slots bottom-to-top, so slot 0 is the root that carries the tail', () => {
    const bubbles = [
      member('left', 0, -40), // highest on screen, so the newest message's slot
      member('left', 0, 10),
      member('left', 0, -15),
    ]
    expect(chainSlots(bubbles, 'left', 0)).toEqual([1, 2, 0])
  })

  it('keeps array order between slots drawn at the same height', () => {
    const bubbles = [member('left', 0, 5), member('left', 0, 5), member('left', 0, 5)]
    expect(chainSlots(bubbles, 'left', 0)).toEqual([0, 1, 2])
  })

  it('takes only the named chain, and only on the named panel', () => {
    const bubbles = [
      member('left', 0, 10),
      member('right', 0, 5), // another chain, same panel
      member('left', 1, 0), // same name, another panel — never on screen together
      member('', 0, -20), // unchained
      member('left', 0, -30),
    ]
    expect(chainSlots(bubbles, 'left', 0)).toEqual([0, 4])
  })

  it('never treats the empty name as a chain', () => {
    expect(chainSlots([member('', 0, 0), member('', 0, 5)], '', 0)).toEqual([])
  })
})

describe('chainIdsOn / chainIds', () => {
  const bubbles = [
    member('right', 1, 0),
    member('left', 0, 0),
    member('', 0, 0),
    member('left', 0, -20),
    member('other', 0, -40),
  ]

  it('lists a panel’s chains once each, in first-appearance order', () => {
    expect(chainIdsOn(bubbles, 0)).toEqual(['left', 'other'])
    expect(chainIdsOn(bubbles, 1)).toEqual(['right'])
    expect(chainIdsOn(bubbles, 2)).toEqual([])
  })

  it('lists every chain on the page for the editor’s completions', () => {
    expect(chainIds(bubbles)).toEqual(['right', 'left', 'other'])
  })
})

describe('chainTranscript', () => {
  it('speaks the chain’s own messages when it has any', () => {
    expect(chainTranscript(chain({ messages: ['a', 'b'] }), ['x', 'y', 'z'])).toEqual(['a', 'b'])
  })

  it('falls back to the balloons’ own text, so growth alone needs no retyping', () => {
    expect(chainTranscript(chain(), ['x', 'y'])).toEqual(['x', 'y'])
  })

  it('copies rather than aliasing, so a caller cannot edit the config', () => {
    const c = chain({ messages: ['a'] })
    chainTranscript(c, []).push('b')
    expect(c.messages).toEqual(['a'])
  })
})

describe('clampHead', () => {
  it('pulls a head into the transcript', () => {
    expect(clampHead(-3, 5)).toBe(0)
    expect(clampHead(9, 5)).toBe(4)
    expect(clampHead(2, 5)).toBe(2)
  })

  it('answers -1 for an empty transcript — there is no message to be at', () => {
    expect(clampHead(0, 0)).toBe(-1)
  })
})

describe('growTarget', () => {
  it('stops where the drawn column is full', () => {
    expect(growTarget(3, 10)).toBe(2)
  })

  it('stops at the last message when the transcript is shorter than the column', () => {
    expect(growTarget(5, 2)).toBe(1)
  })

  it('is -1 with nothing to say', () => {
    expect(growTarget(3, 0)).toBe(-1)
  })
})

describe('visibleWindow', () => {
  it('is short while the chain is still growing, so empty slots go unrendered', () => {
    expect(visibleWindow(0, 3)).toEqual([0])
    expect(visibleWindow(1, 3)).toEqual([0, 1])
  })

  it('fills the column once there are enough messages, oldest in the root slot', () => {
    expect(visibleWindow(2, 3)).toEqual([0, 1, 2])
  })

  it('slides the window so the newest message is always in the top slot', () => {
    expect(visibleWindow(4, 3)).toEqual([2, 3, 4])
  })

  it('is empty with nothing to show or nothing drawn', () => {
    expect(visibleWindow(-1, 3)).toEqual([])
    expect(visibleWindow(2, 0)).toEqual([])
  })

  it('moves each message down exactly one slot per step of the head', () => {
    const before = visibleWindow(4, 3)
    const after = visibleWindow(5, 3)
    // Message 4 was in the top slot and is now one below it: the slide, in numbers.
    expect(before.indexOf(4)).toBe(2)
    expect(after.indexOf(4)).toBe(1)
  })
})

describe('stepHead', () => {
  // Wheel-up gives a negative `steps` (see wheelSteps), and the column runs upward in
  // time, so up has to advance the thread or it reads backwards.
  it('advances the thread on a wheel-up', () => {
    expect(stepHead(2, -1, 10)).toBe(3)
  })

  it('goes back on a wheel-down', () => {
    expect(stepHead(5, 2, 10)).toBe(3)
  })

  it('stops at both ends rather than wrapping', () => {
    expect(stepHead(0, 3, 10)).toBe(0)
    expect(stepHead(9, -3, 10)).toBe(9)
  })
})

describe('defaultChain', () => {
  it('is inert, so a hand-edited config that forgets an entry animates nothing', () => {
    const c = defaultChain('left')
    expect(c.id).toBe('left')
    expect(c.grow).toBe(false)
    expect(c.scroll).toBe(false)
    expect(c.messages).toEqual([])
  })
})

describe('isBubbleChain', () => {
  it('accepts a well-formed entry', () => {
    expect(isBubbleChain(chain())).toBe(true)
  })

  it.each([
    ['not an object', 'left'],
    ['null', null],
    ['an unnamed chain', { ...chain(), id: '' }],
    ['a non-boolean toggle', { ...chain(), grow: 'yes' }],
    ['a non-numeric delay', { ...chain(), stepMs: '900' }],
    ['a non-finite delay', { ...chain(), stepMs: Number.NaN }],
    ['messages that are not an array', { ...chain(), messages: 'hi' }],
    ['a non-string message', { ...chain(), messages: ['hi', 3] }],
  ])('rejects %s', (_label, value) => {
    expect(isBubbleChain(value)).toBe(false)
  })
})
