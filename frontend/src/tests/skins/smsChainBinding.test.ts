import { describe, expect, it } from 'vitest'

import {
  OUT_PREFIX,
  chainColumns,
  chainMembers,
  isComposerContent,
  peerPickerOn,
  smsTranscript,
} from '../../skins/comic-book/bubbleChain'
import type { BubbleChain } from '../../skins/comic-book/bubbleChain'
import { hydrateChains } from '../../skins/comic-book/editor/chainOps'
import {
  PANEL_BUBBLE_CHAINS,
  PANEL_BUBBLE_TRANSFORMS,
} from '../../skins/comic-book/editor/layoutConfig'
import { serializeChains } from '../../skins/comic-book/editor/serialize'

// The pure half of binding a chain to a real thread: which balloon on a panel names the
// counterparty, how a carrier transcript is spelled for the renderer, and whether the
// `sms` flag survives a trip through the editor's own file format.
//
// Its own file because the two modules it spans are both already past the size guideline,
// and because the seam is the feature: `bubbleChain.test.ts` is about drawing a chain,
// this is about a chain that is no longer only a drawing.

/** Just the fields `peerPickerOn` reads, so a case is legible as the rule it tests. */
const b = (panel: number, chain: string, content: string) => ({ panel, chain, content })

const chain = (over: Partial<BubbleChain> = {}): BubbleChain => ({
  id: 'chain-1',
  grow: false,
  stepMs: 900,
  rows: 4,
  sms: false,
  messages: [],
  ...over,
})

describe('the shipped page’s bound chain', () => {
  // A chain only grows a composer when its *sender* template is a field, and it only
  // has a sender and a recipient when both balloons name the same id. The home page
  // once shipped its two SMS balloons as lettering, one on each of two ids — two
  // one-column threads and nowhere to type — which read as the simulation being broken
  // rather than as the page having no input. Every bound chain must be typeable.
  const bound = PANEL_BUBBLE_CHAINS.filter(c => c.sms)

  it('binds at least one chain to real SMS', () => {
    expect(bound.length).toBeGreaterThan(0)
  })

  it('gives each one a blank composer, a recipient template and a picker', () => {
    for (const { id } of bound) {
      const panels = new Set(PANEL_BUBBLE_TRANSFORMS.filter(b => b.chain === id).map(b => b.panel))
      expect(panels.size).toBe(1)
      const [panel] = panels
      const members = chainMembers(PANEL_BUBBLE_TRANSFORMS, id, panel).map(i => PANEL_BUBBLE_TRANSFORMS[i])
      expect(members.length).toBeGreaterThanOrEqual(2)
      const cols = chainColumns(members)
      if (cols === null) throw new Error(`${id} has no columns`)
      expect(isComposerContent(cols.me.content)).toBe(true)
      expect(cols.me.text).toBe('')
      expect(cols.them.content).toBe('text')
      expect(peerPickerOn(PANEL_BUBBLE_TRANSFORMS, panel)).not.toBe(-1)
    }
  })

  it('lists exactly the chain ids its balloons name', () => {
    const named = new Set(PANEL_BUBBLE_TRANSFORMS.map(b => b.chain).filter(id => id !== ''))
    expect(new Set(PANEL_BUBBLE_CHAINS.map(c => c.id))).toEqual(named)
  })
})

describe('peerPickerOn', () => {
  it('finds the panel’s wheel-picker balloon', () => {
    const bubbles = [b(0, '', 'text'), b(0, '', 'wheel')]
    expect(peerPickerOn(bubbles, 0)).toBe(1)
  })

  it('finds a dial balloon too', () => {
    // A dial is a wheel whose picked row is typeable, so it names a counterparty the same
    // way — a chain beside one must bind rather than draw nothing.
    expect(peerPickerOn([b(0, '', 'text'), b(0, '', 'dial')], 0)).toBe(1)
  })

  it('finds a dial carrying a call key, which names a counterparty the same way', () => {
    expect(peerPickerOn([b(0, '', 'text'), b(0, '', 'dial-call')], 0)).toBe(1)
  })

  it('is -1 on a panel that has no picker', () => {
    expect(peerPickerOn([b(0, '', 'text')], 0)).toBe(-1)
  })

  it('ignores a picker belonging to another panel', () => {
    // Two panels each with their own conversation must not read each other's number.
    expect(peerPickerOn([b(1, '', 'wheel')], 0)).toBe(-1)
  })

  it('ignores a picker that is itself part of a chain', () => {
    // A wheel inside a conversation is choosing what to *say*, not who to say it to.
    expect(peerPickerOn([b(0, 'chain-1', 'wheel')], 0)).toBe(-1)
    expect(peerPickerOn([b(0, 'chain-1', 'dial')], 0)).toBe(-1)
  })

  it('takes the first free picker when a panel has several', () => {
    const bubbles = [b(0, 'chain-1', 'wheel'), b(0, '', 'dial'), b(0, '', 'wheel')]
    expect(peerPickerOn(bubbles, 0)).toBe(1)
  })

  it('is -1 for an empty page', () => {
    expect(peerPickerOn([], 0)).toBe(-1)
  })
})

describe('smsTranscript', () => {
  it('marks the sender’s side and leaves the recipient’s bare', () => {
    const rows = smsTranscript([
      { text: 'you around?', outbound: false },
      { text: 'just picked up', outbound: true },
    ])
    expect(rows).toEqual(['you around?', `${OUT_PREFIX}just picked up`])
  })

  it('keeps the carrier’s order rather than grouping by side', () => {
    const rows = smsTranscript([
      { text: 'one', outbound: true },
      { text: 'two', outbound: false },
      { text: 'three', outbound: true },
    ])
    expect(rows.map(r => r.startsWith(OUT_PREFIX))).toEqual([true, false, true])
  })

  it('does not mark an inbound message that happens to start with the marker', () => {
    // The marker is how a *side* is spelled, so text a stranger typed must not move a
    // balloon into the customer's column.
    const rows = smsTranscript([{ text: `${OUT_PREFIX}quoted`, outbound: false }])
    expect(rows).toEqual([`${OUT_PREFIX}quoted`])
  })

  it('is empty for a thread with nothing in it yet', () => {
    expect(smsTranscript([])).toEqual([])
  })
})

describe('the sms flag through the editor’s file format', () => {
  it('round-trips a bound chain', () => {
    const [out] = hydrateChains([chain({ sms: true })])
    expect(out.sms).toBe(true)
  })

  it('reads a chain written before the flag existed as unbound', () => {
    // Every chain already in `layoutConfig.ts` is a drawing, and a backfill that guessed
    // otherwise would start sending real messages from panels nobody bound.
    const older: Record<string, unknown> = { ...chain({ sms: true }) }
    delete older.sms
    expect(hydrateChains([older])[0].sms).toBe(false)
  })

  it('emits the flag, so an editor save does not delete it', () => {
    // serialize.ts overwrites layoutConfig.ts verbatim: a field it does not write is a
    // field that survives exactly until the author's next save.
    const source = serializeChains([chain({ sms: true })])
    expect(source).toContain('sms: true')
    expect(hydrateChains(evalChains(source))[0].sms).toBe(true)
  })

  it('emits an unbound chain as false rather than omitting it', () => {
    expect(serializeChains([chain({ sms: false })])).toContain('sms: false')
  })
})

/**
 * The array literal out of a serialized module, as data. `serializeChains` emits TypeScript
 * source, and the assertion worth making is that hydration reads back what it wrote — not
 * that some substring is present.
 */
function evalChains(source: string): unknown {
  // Anchored on the assignment, not on the first `[`: the header is prose and the
  // annotation is `BubbleChain[]`, both of which come first.
  const marker = 'PANEL_BUBBLE_CHAINS: BubbleChain[] = '
  const literal = source.slice(source.indexOf(marker) + marker.length, source.lastIndexOf(']') + 1)
  return JSON.parse(
    literal
      .replace(/'/g, '"')
      .replace(/([{,]\s*)([A-Za-z]+):/g, '$1"$2":')
      .replace(/,(\s*[\]}])/g, '$1'),
  )
}
