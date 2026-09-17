import { describe, expect, it } from 'vitest'

import {
  CHAIN_MIN_WIDTH_RATIO,
  chainRowLinks,
  chainColumns,
  chainIds,
  chainIdsOn,
  chainMembers,
  chainTranscript,
  clampHead,
  defaultChain,
  growTarget,
  isBubbleChain,
  isComposerContent,
  messageRows,
  mirrorColumn,
  readTranscript,
  sideOrdinals,
  stepHead,
  TYPING_KEY,
  visibleWindow,
} from '../../skins/comic-book/bubbleChain'
import type { BubbleChain, ChainRow } from '../../skins/comic-book/bubbleChain'
import { fitComposer, fitMessage } from '../../skins/comic-book/bubbleFit'
import { anchorOf } from '../../skins/comic-book/chainAnchor'
import { CHAIN_ROW_GAP, rowEllipse } from '../../skins/comic-book/chainLayout'
import { conversationRows } from '../../skins/comic-book/chainRows'
import type { ChainMetrics } from '../../skins/comic-book/chainLayout'
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
  sms: false,
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

describe('sideOrdinals', () => {
  it('counts each message among its own speaker’s, in transcript order', () => {
    const lines = readTranscript(['a', '> b', 'c', 'd', '> e'])
    expect(sideOrdinals(lines)).toEqual([0, 0, 1, 2, 1])
  })

  it('is empty for an empty transcript', () => {
    expect(sideOrdinals([])).toEqual([])
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
  // The left column's left edge — 100 - 55 - 40 — and the right column's right edge.
  const THEM_LEFT = 5
  const ME_RIGHT = 5
  // A square box a column of 40% holds a few words across in.
  const M: ChainMetrics = { aspect: 1, boxW: 400, lettering: 12 }
  const lines = readTranscript(['hey', 'you around?', '> just picked up'])
  const shown = visibleWindow(2, 6) // [2, 1, 0] — newest first
  /** An empty composer on `me`: the fit a live chain's bottom row starts at. */
  const composerOn = (me: BubbleTransform) => fitComposer('', me.type, me.width, M)

  const rows = conversationRows(shown, lines, cols, null, M)

  /** A row's left edge, in the % a bubble is placed in. */
  const leftOf = (r: ChainRow) => 100 - r.bubble.right - r.bubble.width

  // The author's picture: two of theirs in a row, then one of mine, bottom-up on screen.
  it('walks up the panel newest first, one row per message', () => {
    expect(rows.map(r => r.key)).toEqual(['2', '1', '0'])
    expect(rows.map(r => r.bubble.text)).toEqual(['just picked up', 'you around?', 'hey'])
  })

  it('keeps the sender’s rows inside the right column and the recipient’s inside the left', () => {
    expect(rows[0].bubble.right).toBeGreaterThanOrEqual(ME_RIGHT)
    expect(leftOf(rows[0])).toBeGreaterThanOrEqual(100 - ME_RIGHT - cols.me.width - 1e-9)
    for (const r of rows.slice(1)) {
      expect(leftOf(r)).toBeGreaterThanOrEqual(THEM_LEFT - 1e-9)
      expect(leftOf(r) + r.bubble.width).toBeLessThanOrEqual(THEM_LEFT + cols.them.width + 1e-9)
    }
  })

  // A longer thread, for the rows above the two anchored ones: three of theirs stacked
  // up the left column, two of mine up the right.
  const many = readTranscript(['hey', 'you around?', '> just picked up', 'any luck?', '> some', 'ok'])
  const table = conversationRows(visibleWindow(5, 6), many, cols, null, M)
  const at = (t: readonly ChainRow[], key: string): ChainRow => {
    const found = t.find(r => r.key === key)
    if (!found) throw new Error(`no row ${key}`)
    return found
  }

  // The zig-zag: a speaker's stacked balloons alternate between the column's outer edge
  // and a lean inward, by the message's ordinal on that side.
  it('leans every other row of a speaker inward from the column’s edge', () => {
    const flush = (r: ChainRow) => Math.abs(leftOf(r) - THEM_LEFT) < 1e-9
    expect(flush(at(table, '0'))).toBe(true) // their first
    expect(flush(at(table, '1'))).toBe(false) // their second
    expect(flush(at(table, '3'))).toBe(true) // their third
  })

  it('leans by the message’s place in the transcript, not its row on screen', () => {
    // Scroll the window by one: message 1 moves up a row and keeps its lean.
    const scrolled = conversationRows(visibleWindow(4, 6), many, cols, null, M)
    expect(at(scrolled, '1').bubble.right).toBeCloseTo(at(table, '1').bubble.right, 6)
  })

  it('sizes each older row to its own message', () => {
    const min = cols.them.width * CHAIN_MIN_WIDTH_RATIO
    const around = fitMessage('you around?', cols.them.type, cols.them.width, min, M)
    expect(at(table, '1').bubble.width).toBeCloseTo(around.width, 6)
    expect(at(table, '1').stretch).toBeCloseTo(around.stretch, 6)
    expect(at(table, '0').bubble.width).toBeLessThan(at(table, '1').bubble.width)
    expect(at(table, '1').bubble.width).toBeLessThan(cols.them.width)
  })

  it('stretches a row whose message wraps, and no other', () => {
    const long = 'x'.repeat(30)
    const wrapped = conversationRows([1, 0], readTranscript(['hey', `> ${long} ${long}`]), cols, null, M)
    expect(wrapped[0].stretch).toBeGreaterThan(1)
    expect(wrapped[1].stretch).toBe(1)
  })

  /** Where a row's tail points on the panel — or its ellipse centre, with no tail. */
  const anchorOfRow = (r: ChainRow) => anchorOf(r.bubble, 1, r.stretch)
  const expectSamePoint = (a: readonly number[], b: readonly number[]) => {
    expect(a[0]).toBeCloseTo(b[0], 6)
    expect(a[1]).toBeCloseTo(b[1], 6)
  }

  // The author drew each template by hand — sized it, placed it, aimed its tail at a
  // character's mouth — and the newest balloon of each side starts as that drawing: a
  // message that fits on one line leaves it exactly as drawn, not shrunk to its words,
  // not leaned, not hung from a corner.
  it('starts the newest row of each side at its template’s size and place', () => {
    const [mine, theirs] = rows
    for (const [row, template] of [[mine, cols.me], [theirs, cols.them]] as const) {
      expect(row.bubble.width).toBe(template.width)
      expect(row.stretch).toBe(1)
      expect(row.bubble.top).toBeCloseTo(template.top, 6)
      expect(row.bubble.right).toBeCloseTo(template.right, 6)
      expect(row.bubble.rotate).toBe(template.rotate)
      expect(row.bubble.tail).toBe(template.tail)
    }
    // A short message does not shrink it — the same words in an older row are narrower.
    expect(at(table, '3').bubble.width).toBeLessThan(cols.them.width)
  })

  it('grows the newest row taller for a message that wraps, holding its tail tip still', () => {
    const long = 'x'.repeat(30)
    const [tall] = conversationRows([0], readTranscript([`> ${long} ${long}`]), cols, null, M)
    expect(tall.stretch).toBeGreaterThan(1)
    expect(tall.bubble.width).toBe(cols.me.width)
    expectSamePoint(anchorOfRow(tall), anchorOf(cols.me, 1))
    // A tail pointing down keeps its tip, so the extra height goes upward.
    expect(tall.bubble.top).toBeLessThan(cols.me.top)
  })

  it('centres a tailless template’s newest row on its ellipse instead', () => {
    const bare = { ...cols, them: tpl({ ...cols.them, tail: 'none' }) }
    const [, around] = conversationRows(shown, lines, bare, null, M)
    expect(around.bubble.tail).toBe('none')
    expectSamePoint(anchorOfRow(around), anchorOf(bare.them, 1))
  })

  it('draws the typing row as the recipient’s template, where the reply will land', () => {
    const [dots] = conversationRows([], [], cols, null, M, true)
    expect(dots.key).toBe(TYPING_KEY)
    expect(dots.bubble.width).toBe(cols.them.width)
    expect(dots.bubble.top).toBeCloseTo(cols.them.top, 6)
    expect(dots.bubble.right).toBeCloseTo(cols.them.right, 6)
    expectSamePoint(anchorOfRow(dots), anchorOf(cols.them, 1))
  })

  it('climbs from the anchored rows, each older row above the one below it', () => {
    const stacked = table.filter(r => r.bubble.tail === 'none')
    expect(stacked.length).toBe(table.length - 2)
    for (const r of stacked) {
      const below = table[table.indexOf(r) - 1]
      expect(rowEllipse(r, 1).y2).toBeLessThan(rowEllipse(below, 1).y2)
    }
  })

  // Rows may tuck in beside each other but never over each other: two ellipses that share
  // any horizontal span keep the row gap between them.
  const expectNoOverlap = (t: readonly ChainRow[]) => {
    for (let i = 0; i < t.length; i += 1) {
      for (let j = i + 1; j < t.length; j += 1) {
        const a = rowEllipse(t[i], 1)
        const b = rowEllipse(t[j], 1)
        if (a.x2 <= b.x1 || b.x2 <= a.x1) continue
        // Whichever is the upper one, the gap between them is at least the row gap.
        expect(Math.max(a.y1 - b.y2, b.y1 - a.y2)).toBeGreaterThanOrEqual(CHAIN_ROW_GAP - 1e-9)
      }
    }
  }

  it('never lets two balloons overlap, however they interleave', () => {
    expectNoOverlap(table)
  })

  // The recipient's newest message is anchored wherever the author drew their template,
  // which can be right where the sender's older rows would otherwise have stacked. Those
  // rows must clear it even though it comes later in the transcript than they do.
  it('stacks older rows clear of an anchored row that comes later in the transcript', () => {
    // Their template straight above mine, in the same column.
    const stackedCols = {
      me: tpl({ top: 60, right: 5, width: 40, tail: 'down-left', content: 'input' }),
      them: tpl({ top: 30, right: 5, width: 40, tail: 'down-right' }),
    }
    const thread = readTranscript(['hey', '> a', '> b'])
    const live = conversationRows(visibleWindow(2, 6), thread, stackedCols, composerOn(stackedCols.me), M)
    expect(live.map(r => r.key)).toEqual(['composer', '2', '1', '0'])
    expectSamePoint(anchorOfRow(at(live, '0')), anchorOf(stackedCols.them, 1))
    expectNoOverlap(live)
  })

  // The other speaker's reply sits alongside the message it answers rather than wholly
  // above it — this is what pulls the two columns together on the panel.
  it('tucks a reply in beside the message it answers', () => {
    const picked = rowEllipse(at(table, '2'), 1)
    const luck = rowEllipse(at(table, '3'), 1)
    expect(picked.y2).toBeGreaterThan(luck.y1)
    expect(picked.y2).toBeLessThan(luck.y2)
  })

  it('links rows vertically within each speaker column only', () => {
    expect(chainRowLinks(rows, 1).map(pair => pair.map(row => row.key))).toEqual([['1', '0']])
    const alternating = conversationRows(
      visibleWindow(3, 6),
      readTranscript(['in one', '> out one', 'in two', '> out two']),
      cols,
      null,
      M,
    )
    expect(chainRowLinks(alternating, 1).map(pair => pair.map(row => row.side))).toEqual([
      ['out', 'out'],
      ['in', 'in'],
    ])
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
      null,
      M,
    )
    expect(live.map(r => r.bubble.content)).toEqual(['text', 'text', 'text'])
  })

  it('links nothing, because a stamped row is not a balloon to link to', () => {
    expect(rows.every(r => r.bubble.linkTo === null)).toBe(true)
  })

  it('puts the composer in the bottom row of the sender’s column when the chain is live', () => {
    const me = tpl({ ...cols.me, content: 'input', text: 'Say something' })
    const live = conversationRows([0], readTranscript(['hey']), { ...cols, me }, composerOn(me), M)

    expect(live.map(r => r.key)).toEqual(['composer', '0'])
    expect(live[0].bubble.content).toBe('input')
    expect(live[0].bubble.top).toBeCloseTo(me.top, 6)
    // The composer is the template itself, drawn where the author put it: no lean.
    expect(live[0].bubble.right).toBeCloseTo(me.right, 6)
    expect(live[0].stretch).toBe(1)
    // The composer is the sender still talking, so the message above it takes no second tail.
    expect(live[0].bubble.tail).toBe('down-left')
    expect(live[1].bubble.tail).toBe('down-right')
  })

  // The composer answers to what is being typed into it the way a message answers to its
  // words — taller, never narrower, and around the tail tip the author aimed.
  it('grows the composer upward as its draft wraps, and shrinks it back when sent', () => {
    const me = tpl({ ...cols.me, content: 'input', text: 'Say something' })
    const draft = 'a message long enough to wrap onto more than one line of the balloon'
    // One of the sender's own messages, which is the row that stacks above the composer.
    const thread = readTranscript(['> earlier'])
    const typing = conversationRows([0], thread, { ...cols, me },
      fitComposer(draft, me.type, me.width, M), M)
    const empty = conversationRows([0], thread, { ...cols, me }, composerOn(me), M)

    expect(typing[0].stretch).toBeGreaterThan(1)
    // As wide as the author drew it, whatever is in it: a field is a target, not a word count.
    expect(typing[0].bubble.width).toBe(me.width)
    // Taller around the same tail tip, so the words push the thread up instead of the
    // tail sliding off the mouth it was aimed at.
    expectSamePoint(anchorOfRow(typing[0]), anchorOf(me, 1))
    expect(typing[0].bubble.top).toBeLessThan(empty[0].bubble.top)
    // And the message above it is pushed clear rather than drawn through.
    expect(at(typing, '0').bubble.top).toBeLessThan(at(empty, '0').bubble.top)
    expectNoOverlap(typing)
    expect(empty[0].stretch).toBe(1)
  })

  it('draws every older row at its narrowest with no lettering size to fit against', () => {
    const blind = conversationRows(visibleWindow(5, 6), many, cols, null, { ...M, lettering: 0 })
    for (const r of blind) {
      const newest = r.bubble.tail !== 'none'
      expect(r.bubble.width).toBeCloseTo(newest ? 40 : 40 * CHAIN_MIN_WIDTH_RATIO, 6)
      expect(r.stretch).toBe(1)
    }
  })

  it('skips a window entry the transcript has nothing at', () => {
    expect(conversationRows([9], lines, cols, null, M)).toEqual([])
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

  // A window is a fixed pane over the transcript: scrolling back through twenty messages
  // moves them through six rows, it does not empty the pane one row at a time until a
  // single balloon is left under five blank rows. `floor` is the head at which the table
  // is first full, and the wheel does not go below it.
  it('stops where the window is still full rather than thinning it to one row', () => {
    expect(stepHead(8, -2, 20, growTarget(6, 20))).toBe(6)
    expect(stepHead(6, -3, 20, growTarget(6, 20))).toBe(5)
    expect(stepHead(5, -1, 20, growTarget(6, 20))).toBe(5)
  })

  // Growth climbs the head from 0, below the floor. The first turn of the wheel ends it,
  // and lands on the floor rather than one row further back: the reader steered, so the
  // table is full.
  it('lifts a head left below the floor by growth onto it', () => {
    expect(stepHead(2, -1, 20, growTarget(6, 20))).toBe(5)
  })

  // Shorter than the table, the floor is the newest message, because the whole transcript
  // is already on screen and there is nothing above it to scroll to.
  it('leaves a transcript shorter than the table where it is', () => {
    expect(stepHead(1, -4, 2, growTarget(6, 2))).toBe(1)
  })

  it('never parks the head past the end when the floor outruns the transcript', () => {
    expect(stepHead(0, -1, 1, 5)).toBe(0)
    expect(stepHead(0, -1, 0, 5)).toBe(-1)
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
