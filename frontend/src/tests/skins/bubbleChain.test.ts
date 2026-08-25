import { describe, expect, it } from 'vitest'

import { BUBBLE_ASPECT } from '../../skins/comic-book/bubbleBox'
import {
  CHAIN_FULL_CHARS,
  CHAIN_MIN_WIDTH_RATIO,
  CHAIN_ROW_GAP,
  bubbleHeightPct,
  chainColumns,
  chainIds,
  chainIdsOn,
  chainMembers,
  chainTranscript,
  clampHead,
  conversationRows,
  defaultChain,
  growTarget,
  isBubbleChain,
  isComposerContent,
  messageRows,
  messageWidth,
  mirrorColumn,
  readTranscript,
  stepHead,
  visibleWindow,
} from '../../skins/comic-book/bubbleChain'
import type { BubbleChain } from '../../skins/comic-book/bubbleChain'
import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'

const member = (chain: string, panel: number, right: number) => ({ chain, panel, right })

const tpl = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  ...NEW_BUBBLE,
  panel: 0,
  text: '',
  ...over,
})

const chain = (over: Partial<BubbleChain> = {}): BubbleChain => ({
  id: 'chain-1',
  grow: true,
  stepMs: 900,
  rows: 6,
  messages: [],
  ...over,
})

describe('chainMembers', () => {
  // `right` is measured inward from the panel's right edge, so the smallest is rightmost —
  // and the rightmost balloon is the sender's column by definition.
  it('orders members rightmost first, so member 0 is the sender’s template', () => {
    const bubbles = [
      member('left', 0, 55), // furthest left, so the recipient's column
      member('left', 0, 5),
      member('left', 0, 30),
    ]
    expect(chainMembers(bubbles, 'left', 0)).toEqual([1, 2, 0])
  })

  it('keeps array order between balloons drawn at the same edge', () => {
    const bubbles = [member('left', 0, 5), member('left', 0, 5), member('left', 0, 5)]
    expect(chainMembers(bubbles, 'left', 0)).toEqual([0, 1, 2])
  })

  it('takes only the named chain, and only on the named panel', () => {
    const bubbles = [
      member('left', 0, 10),
      member('right', 0, 5), // another chain, same panel
      member('left', 1, 0), // same name, another panel — never on screen together
      member('', 0, 20), // unchained
      member('left', 0, 40),
    ]
    expect(chainMembers(bubbles, 'left', 0)).toEqual([0, 4])
  })

  it('never treats the empty name as a chain', () => {
    expect(chainMembers([member('', 0, 0), member('', 0, 5)], '', 0)).toEqual([])
  })
})

describe('chainIdsOn / chainIds', () => {
  const bubbles = [
    member('right', 1, 0),
    member('left', 0, 0),
    member('', 0, 0),
    member('left', 0, 20),
    member('other', 0, 40),
  ]

  it('lists a panel’s chains once each, in first-appearance order', () => {
    expect(chainIdsOn(bubbles, 0)).toEqual(['left', 'other'])
    expect(chainIdsOn(bubbles, 1)).toEqual(['right'])
    expect(chainIdsOn(bubbles, 2)).toEqual([])
  })

  it('lists every chain on the page, whatever panel each is drawn on', () => {
    expect(chainIds(bubbles)).toEqual(['right', 'left', 'other'])
  })
})

describe('mirrorColumn', () => {
  it('puts the balloon’s left edge where its right edge was', () => {
    // 12% in from the right, 40 wide -> 48 from the left edge -> 12 in from the left.
    expect(mirrorColumn(tpl({ right: 12, width: 40 })).right).toBe(48)
  })

  it('is its own inverse, so mirroring twice is where the author drew it', () => {
    const b = tpl({ right: 12, width: 40 })
    expect(mirrorColumn(mirrorColumn(b)).right).toBe(b.right)
  })

  it('changes nothing else, because a column is the same balloon on the other side', () => {
    const b = tpl({ right: 12, width: 40, type: 'cloud', text: 'hi' })
    expect(mirrorColumn(b)).toEqual({ ...b, right: 48 })
  })
})

describe('chainColumns', () => {
  const me = tpl({ right: 5, width: 40, text: 'mine' })
  const them = tpl({ right: 55, width: 40, text: 'theirs' })

  it('reads the rightmost member as the sender and the leftmost as the recipient', () => {
    expect(chainColumns([me, them])).toEqual({ me, them })
  })

  it('mirrors the one member a half-drawn chain has, so it still reads as a conversation', () => {
    expect(chainColumns([me])).toEqual({ me, them: mirrorColumn(me) })
  })

  // The table is rigidly two columns: a third linked balloon is not a third speaker.
  it('ignores a balloon between the two, rather than making it a column', () => {
    const middle = tpl({ right: 30, width: 40, text: 'ignored' })
    expect(chainColumns([me, middle, them])).toEqual({ me, them })
  })

  it('is null with nothing drawn', () => {
    expect(chainColumns([])).toBeNull()
  })
})

describe('readTranscript', () => {
  it('reads the marker off the sender’s lines and leaves the rest alone', () => {
    expect(readTranscript(['hi', '> yes', 'ok'])).toEqual([
      { out: false, text: 'hi' },
      { out: true, text: 'yes' },
      { out: false, text: 'ok' },
    ])
  })

  it('takes a bare > as the recipient’s, since the marker is the prefix with its space', () => {
    expect(readTranscript(['>nope'])).toEqual([{ out: false, text: '>nope' }])
  })
})

describe('chainTranscript', () => {
  const me = tpl({ right: 5, width: 40, text: 'mine' })
  const them = tpl({ right: 55, width: 40, text: 'theirs' })

  it('speaks the chain’s own messages when it has any', () => {
    expect(chainTranscript(chain({ messages: ['a', '> b'] }), [me, them])).toEqual(['a', '> b'])
  })

  // The recipient opens and the sender answers: the only reading of two drawn balloons that
  // is a conversation rather than a list.
  it('falls back to the templates’ own text, the recipient’s line first', () => {
    expect(chainTranscript(chain(), [me, them])).toEqual(['theirs', '> mine'])
  })

  it('skips a template nobody has lettered yet', () => {
    expect(chainTranscript(chain(), [me, tpl({ right: 55, width: 40 })])).toEqual(['> mine'])
  })

  it('copies rather than aliasing, so a caller cannot edit the config', () => {
    const c = chain({ messages: ['a'] })
    chainTranscript(c, []).push('b')
    expect(c.messages).toEqual(['a'])
  })
})

describe('messageWidth', () => {
  it('gives an empty message the narrowest balloon its column allows', () => {
    expect(messageWidth('', 40)).toBeCloseTo(40 * CHAIN_MIN_WIDTH_RATIO, 6)
  })

  it('fills the column at the full-width length, and stops there', () => {
    const full = 'x'.repeat(CHAIN_FULL_CHARS)
    expect(messageWidth(full, 40)).toBeCloseTo(40, 6)
    // Past it the lettering wraps and the balloon grows downward, not sideways.
    expect(messageWidth(`${full}${full}`, 40)).toBeCloseTo(40, 6)
  })

  it('grows with the message, so a conversation has a ragged edge', () => {
    expect(messageWidth('hi', 40)).toBeLessThan(messageWidth('hi there', 40))
  })
})

describe('bubbleHeightPct', () => {
  it('is the balloon’s own aspect, rescaled by the panel’s', () => {
    expect(bubbleHeightPct(40, 1)).toBeCloseTo(40 * BUBBLE_ASPECT, 6)
    // A panel twice as wide as it is tall: the same width % is twice the height %.
    expect(bubbleHeightPct(40, 2)).toBeCloseTo(80 * BUBBLE_ASPECT, 6)
  })
})

describe('messageRows', () => {
  // The author's "at most X rows, just use 6": six rows hold six messages, unless the
  // sender's template is a field, in which case the bottom row is the one being typed into.
  it('is every row on a chain with no composer', () => {
    expect(messageRows(6, false)).toBe(6)
  })

  it('is one fewer on a live chain, because the bottom row is the field', () => {
    expect(messageRows(6, true)).toBe(5)
  })

  it('never goes negative, so a lone composer simply holds no messages', () => {
    expect(messageRows(1, true)).toBe(0)
    expect(messageRows(0, true)).toBe(0)
  })
})

describe('isComposerContent', () => {
  it('is true for the two content kinds that are real fields', () => {
    expect(isComposerContent('input')).toBe(true)
    expect(isComposerContent('phone')).toBe(true)
  })

  it('is false for content the reader cannot type into', () => {
    expect(isComposerContent('text')).toBe(false)
    expect(isComposerContent('wheel')).toBe(false)
  })
})

describe('conversationRows', () => {
  const cols = {
    me: tpl({ top: 60, right: 5, width: 40, tail: 'down-left' }),
    them: tpl({ top: 60, right: 55, width: 40, tail: 'down-right' }),
  }
  // The left column's left edge — 100 - 55 - 40.
  const THEM_LEFT = 5
  const lines = readTranscript(['hey', 'you around?', '> just picked up'])
  const shown = visibleWindow(2, 6) // [2, 1, 0] — newest first

  const rows = conversationRows(shown, lines, cols, false, 1)

  // The author's picture: two of theirs in a row, then one of mine, bottom-up on screen.
  it('walks up the panel newest first, one row per message', () => {
    expect(rows.map(r => r.key)).toEqual(['2', '1', '0'])
    expect(rows.map(r => r.bubble.text)).toEqual(['just picked up', 'you around?', 'hey'])
  })

  it('hangs the sender’s rows off the right column and the recipient’s off the left', () => {
    expect(rows[0].bubble.right).toBe(cols.me.right)
    for (const r of rows.slice(1)) {
      expect(100 - r.bubble.right - r.bubble.width).toBeCloseTo(THEM_LEFT, 6)
    }
  })

  it('sizes each row to its own message', () => {
    expect(rows[1].bubble.width).toBeCloseTo(messageWidth('you around?', cols.them.width), 6)
    expect(rows[2].bubble.width).toBeCloseTo(messageWidth('hey', cols.them.width), 6)
    expect(rows[2].bubble.width).toBeLessThan(rows[1].bubble.width)
  })

  // Not a fixed pitch: a row is pushed up by the height of the balloon below it, so two
  // balloons of different widths still tile instead of overlapping.
  it('stacks each row on the height of the one below it', () => {
    expect(rows[0].bubble.top).toBe(cols.me.top)
    for (let i = 1; i < rows.length; i += 1) {
      const below = rows[i - 1].bubble
      expect(rows[i].bubble.top).toBeCloseTo(
        below.top - bubbleHeightPct(below.width, 1) - CHAIN_ROW_GAP,
        6,
      )
    }
  })

  it('leaves the tail on the newest balloon of each column and nowhere else', () => {
    expect(rows[0].bubble.tail).toBe('down-left') // newest of the sender's
    expect(rows[1].bubble.tail).toBe('down-right') // newest of the recipient's
    expect(rows[2].bubble.tail).toBe('none') // an older one on the same side
  })

  it('letters every row, whatever the template it was stamped from does', () => {
    const live = conversationRows(
      shown,
      lines,
      { ...cols, me: tpl({ ...cols.me, content: 'input' }) },
      false,
      1,
    )
    expect(live.map(r => r.bubble.content)).toEqual(['text', 'text', 'text'])
  })

  it('links nothing, because a stamped row is not a balloon to link to', () => {
    expect(rows.every(r => r.bubble.linkTo === null)).toBe(true)
  })

  it('puts the composer in the bottom row of the sender’s column when the chain is live', () => {
    const me = tpl({ ...cols.me, content: 'input', text: 'Say something' })
    const live = conversationRows([0], readTranscript(['hey']), { ...cols, me }, true, 1)

    expect(live.map(r => r.key)).toEqual(['composer', '0'])
    expect(live[0].bubble.content).toBe('input')
    expect(live[0].bubble.top).toBe(me.top)
    expect(live[0].bubble.right).toBe(me.right)
    // The composer is the sender still talking, so the message above it takes no second tail.
    expect(live[0].bubble.tail).toBe('down-left')
    expect(live[1].bubble.tail).toBe('down-right')
  })

  it('skips a window entry the transcript has nothing at', () => {
    expect(conversationRows([9], lines, cols, false, 1)).toEqual([])
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
  it('stops where the table is full', () => {
    expect(growTarget(3, 10)).toBe(2)
  })

  it('stops at the last message when the transcript is shorter than the table', () => {
    expect(growTarget(5, 2)).toBe(1)
  })

  it('is -1 with nothing to say', () => {
    expect(growTarget(3, 0)).toBe(-1)
  })
})

describe('visibleWindow', () => {
  it('is short while the conversation is still growing, so empty rows go unrendered', () => {
    expect(visibleWindow(0, 3)).toEqual([0])
    expect(visibleWindow(1, 3)).toEqual([1, 0])
  })

  // result[0] is the bottom row, and the bottom row holds the newest message shown.
  it('fills the table once there are enough messages, newest at the bottom', () => {
    expect(visibleWindow(2, 3)).toEqual([2, 1, 0])
  })

  it('slides the window so the head is always the bottom row', () => {
    expect(visibleWindow(4, 3)).toEqual([4, 3, 2])
  })

  it('is empty with nothing to show or no rows to show it in', () => {
    expect(visibleWindow(-1, 3)).toEqual([])
    expect(visibleWindow(2, 0)).toEqual([])
  })

  it('moves each message up exactly one row per step of the head', () => {
    const before = visibleWindow(4, 3)
    const after = visibleWindow(5, 3)
    // Message 4 was the bottom row and is now one above it: the slide, in numbers.
    expect(before.indexOf(4)).toBe(0)
    expect(after.indexOf(4)).toBe(1)
  })

  // Twenty messages through six rows is six on screen, never twenty.
  it('never shows more rows than the table holds', () => {
    expect(visibleWindow(19, 6)).toHaveLength(6)
  })
})

describe('stepHead', () => {
  // Wheel-up gives a negative `steps` (see wheelSteps). Older messages are *above* the
  // newest, so up walks back through the transcript — the ordinary direction, because the
  // table is laid out the ordinary way.
  it('goes back through the conversation on a wheel-up', () => {
    expect(stepHead(2, -1, 10)).toBe(1)
  })

  it('advances on a wheel-down', () => {
    expect(stepHead(5, 2, 10)).toBe(7)
  })

  it('stops at both ends rather than wrapping', () => {
    expect(stepHead(0, -3, 10)).toBe(0)
    expect(stepHead(9, 3, 10)).toBe(9)
  })
})

describe('defaultChain', () => {
  it('is inert, so a hand-edited config that forgets an entry animates nothing', () => {
    const c = defaultChain('left')
    expect(c.id).toBe('left')
    expect(c.grow).toBe(false)
    expect(c.rows).toBe(6)
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
    ['a non-numeric row cap', { ...chain(), rows: '6' }],
    ['a non-finite row cap', { ...chain(), rows: Number.NaN }],
    ['messages that are not an array', { ...chain(), messages: 'hi' }],
    ['a non-string message', { ...chain(), messages: ['hi', 3] }],
  ])('rejects %s', (_label, value) => {
    expect(isBubbleChain(value)).toBe(false)
  })
})
