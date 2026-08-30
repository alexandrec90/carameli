import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CHAIN_ROWS, bubbleHeightPct, chainColumns, chainMembers,
} from '../../skins/comic-book/bubbleChain'
import type { ChainColumns } from '../../skins/comic-book/bubbleChain'
import { addSmsConversation } from '../../skins/comic-book/editor/chainCreate'
import { chainBoxRect, chainFramesOn, chainTableBox } from '../../skins/comic-book/editor/chainFrame'
import { NEW_BUBBLE, patchBubble, patchChain, seedConfig } from '../../skins/comic-book/editor/configOps'
import type { BubbleTransform, EditorConfig } from '../../skins/comic-book/editor/types'

// The dashed frame the editor draws around a conversation, and the arithmetic under it.
//
// It exists because chains render *flat* in edit mode — both templates drawn where they
// were placed, so both stay selectable — which left the table itself drawn nowhere the
// author could see. Dragging a template or changing `rows` were edits whose whole effect
// was invisible until edit mode was left, and that is what "the editor disagrees with the
// page" was. So the assertions here are mostly one claim in several directions: every way
// of stretching the table moves this box.

/** A column template at a given placement; the rest is the ordinary new-balloon shape. */
function col(placement: Pick<BubbleTransform, 'top' | 'right' | 'width'>): BubbleTransform {
  return { ...NEW_BUBBLE, panel: 6, ...placement }
}

const cols = (me: BubbleTransform, them: BubbleTransform): ChainColumns => ({ me, them })

/** The shipped page with one conversation added to panel 6, and nothing else touched. */
function withConversation(): { config: EditorConfig; index: number } {
  return addSmsConversation({ ...seedConfig(), bubbles: [], chains: [] }, 6)
}

describe('chainTableBox', () => {
  const me = col({ top: 60, right: 8, width: 34 })
  const them = col({ top: 60, right: 58, width: 34 })

  it('is one balloon tall at one row, anchored on the sender', () => {
    const box = chainTableBox(cols(me, them), 1, 1)
    expect(box.top).toBe(me.top)
    expect(box.height).toBeCloseTo(bubbleHeightPct(me.width, 1))
  })

  // Rows stack *upward* from the sender — that is where a conversation happens, the newest
  // message at the composer and older ones climbing away — so more rows reach further up
  // the panel and never further down it.
  it('climbs the panel as rows are added, keeping its foot where it was', () => {
    const one = chainTableBox(cols(me, them), 1, 1)
    const four = chainTableBox(cols(me, them), 4, 1)
    const six = chainTableBox(cols(me, them), 6, 1)
    expect(four.top).toBeLessThan(one.top)
    expect(six.top).toBeLessThan(four.top)
    expect(six.height).toBeGreaterThan(four.height)
    expect(six.top + six.height).toBeCloseTo(one.top + one.height)
  })

  it('spans both columns, from the nearer edge to the far one', () => {
    const box = chainTableBox(cols(me, them), 6, 1)
    expect(box.right).toBe(8)
    expect(box.right + box.width).toBe(58 + 34)
  })

  // The three assertions that are the author's answer to "how do I stretch it": widen a
  // template, move one, or ask for more rows.
  it('widens with the column that reaches furthest', () => {
    const base = chainTableBox(cols(me, them), 6, 1)
    const wider = chainTableBox(cols(me, col({ top: 60, right: 58, width: 44 })), 6, 1)
    expect(wider.width).toBeCloseTo(base.width + 10)
  })

  // The box is the *union* of the two columns, not the sum of them: the sender's balloons
  // hang from its right edge and the recipient's from its left, so the table's edges are
  // the outer two and widening a column inward moves nothing the author can see.
  it('holds still when a column widens into the space between them', () => {
    const box = chainTableBox(cols(col({ top: 60, right: 8, width: 44 }), them), 6, 1)
    expect(box.right).toBe(8)
    expect(box.right + box.width).toBe(58 + 34)
  })

  it('follows a column dragged outward', () => {
    const base = chainTableBox(cols(me, them), 6, 1)
    const pushed = chainTableBox(cols(me, col({ top: 60, right: 64, width: 34 })), 6, 1)
    expect(pushed.width).toBeGreaterThan(base.width)
  })

  it('follows the sender down the panel, since that is what the rows hang from', () => {
    const lower = chainTableBox(cols(col({ top: 70, right: 8, width: 34 }), them), 6, 1)
    const base = chainTableBox(cols(me, them), 6, 1)
    expect(lower.top).toBeGreaterThan(base.top)
  })

  // A panel is rarely square, and a balloon's height comes from its *width* — so the same
  // table on a wide panel is taller in percentage terms. Nothing else in the box reads it.
  it('reads the panel’s aspect for its height and nothing else', () => {
    const square = chainTableBox(cols(me, them), 6, 1)
    const wide = chainTableBox(cols(me, them), 6, 2)
    expect(wide.height).toBeGreaterThan(square.height)
    expect(wide.right).toBe(square.right)
    expect(wide.width).toBe(square.width)
  })

  it('treats a row count below one as a single row rather than an inverted box', () => {
    const box = chainTableBox(cols(me, them), 0, 1)
    expect(box.top).toBe(me.top)
    expect(box.height).toBeGreaterThan(0)
  })
})

describe('chainBoxRect', () => {
  // `right` is measured inward from the panel's right edge, the way every bubble on this
  // skin is placed; the frame has to land the same way round or it would sit mirrored on
  // any panel that is not centred.
  it('places the box inward from the panel’s right edge', () => {
    const rect = chainBoxRect(
      { x: 100, y: 50, w: 200, h: 100 },
      { top: 60, right: 8, width: 84, height: 20 },
    )
    expect(rect.x).toBeCloseTo(100 + 16)
    expect(rect.w).toBeCloseTo(168)
    expect(rect.x + rect.w).toBeCloseTo(100 + 200 - 16)
    expect(rect.y).toBeCloseTo(50 + 60)
    expect(rect.h).toBeCloseTo(20)
  })
})

describe('chainFramesOn', () => {
  const bounds = { x: 0, y: 0, w: 400, h: 400 }

  it('draws one frame per conversation on the panel', () => {
    const { config } = withConversation()
    const frames = chainFramesOn(config.bubbles, config.chains, 6, bounds)
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe(config.bubbles[0].chain)
  })

  it('draws none on a panel that has no conversation', () => {
    const { config } = withConversation()
    expect(chainFramesOn(config.bubbles, config.chains, 7, bounds)).toEqual([])
  })

  it('draws none for a page with no chains at all', () => {
    const seed = { ...seedConfig(), bubbles: [], chains: [] }
    expect(chainFramesOn(seed.bubbles, seed.chains, 6, bounds)).toEqual([])
  })

  // The frame is the visible half of the `rows` field; a change there that did not move it
  // would be the invisible edit all over again.
  it('grows with the chain’s row count', () => {
    const { config } = withConversation()
    const id = config.bubbles[0].chain
    const shallow = patchChain(config, id, { rows: 2 })
    const deep = patchChain(config, id, { rows: 10 })
    const few = chainFramesOn(shallow.bubbles, shallow.chains, 6, bounds)
    const many = chainFramesOn(deep.bubbles, deep.chains, 6, bounds)
    expect(many[0].rect.h).toBeGreaterThan(few[0].rect.h)
    expect(many[0].rect.y).toBeLessThan(few[0].rect.y)
  })

  it('moves when a template is dragged', () => {
    const { config, index } = withConversation()
    const before = chainFramesOn(config.bubbles, config.chains, 6, bounds)[0]
    const moved = patchBubble(config, index, { top: config.bubbles[index].top - 20 })
    const after = chainFramesOn(moved.bubbles, moved.chains, 6, bounds)[0]
    expect(after.rect.y).toBeLessThan(before.rect.y)
  })

  // A hand-edited `layoutConfig.ts` that ids a chain on two bubbles and forgets the entry
  // gets `defaultChain` at render time; the frame has to agree with what will be drawn.
  it('falls back to the default row count when the chain entry is missing', () => {
    const { config } = withConversation()
    const orphaned = { ...config, chains: [] }
    const frames = chainFramesOn(orphaned.bubbles, orphaned.chains, 6, bounds)
    const members = chainMembers(orphaned.bubbles, orphaned.bubbles[0].chain, 6)
    const columns = chainColumns(members.map(i => orphaned.bubbles[i]))!
    const expected = chainTableBox(columns, DEFAULT_CHAIN_ROWS, bounds.w / bounds.h)
    expect(frames).toHaveLength(1)
    expect(frames[0].rect.h).toBeCloseTo((bounds.h * expected.height) / 100)
  })

  // A chain of one is what a conversation is mid-repair, and `chainColumns` mirrors the
  // lone template for its other side — so the frame still spans two columns.
  it('frames a one-column chain across the mirror of the column it has', () => {
    const { config, index } = withConversation()
    const lone = { ...config, bubbles: config.bubbles.filter((_, i) => i !== index + 1) }
    const frames = chainFramesOn(lone.bubbles, lone.chains, 6, bounds)
    expect(frames).toHaveLength(1)
    expect(frames[0].rect.w).toBeGreaterThan(0)
  })
})
