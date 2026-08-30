import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CHAIN_ROWS,
  chainMembers,
  isComposerContent,
  peerPickerOn,
} from '../../skins/comic-book/bubbleChain'
import { addPeerPicker, addSmsConversation } from '../../skins/comic-book/editor/chainCreate'
import { hydrateConfig, seedConfig } from '../../skins/comic-book/editor/configOps'
import type { EditorConfig } from '../../skins/comic-book/editor/types'

// What **+ SMS** makes. A conversation used to be six couplings the author established one
// at a time — two balloons, a link, a chain id, the sender's content, the bound flag, and a
// picker balloon somewhere else on the panel — with no sign at any point which of them were
// still missing. Every assertion here is one of those couplings, and together they are the
// claim that the button leaves a *working* conversation rather than the parts of one.
//
// The chain list's own arithmetic is in editorChainOps.test.ts, its place in a config in
// editorChainConfig.test.ts, and the table's geometry in editorChainFrame.test.ts.

/** A config with nothing drawn on it, so bubble indices are the op's own. */
const empty = (): EditorConfig => ({ ...seedConfig(), bubbles: [], chains: [] })

describe('addSmsConversation', () => {
  it('spawns exactly two root bubbles, both on the named panel', () => {
    const { config } = addSmsConversation(empty(), 6)
    expect(config.bubbles).toHaveLength(2)
    expect(config.bubbles.map(b => b.panel)).toEqual([6, 6])
  })

  // The id is derived from the linkage, so the two have to be linked or they are two
  // groups of one and the chain comes apart the next time anything reconciles.
  it('links the two halves, which is what makes them one conversation', () => {
    const { config, index } = addSmsConversation(empty(), 6)
    expect(config.bubbles[1].linkTo).toBe(index)
  })

  it('puts both in one chain, under an id the author never types', () => {
    const { config } = addSmsConversation(empty(), 6)
    const [id] = config.bubbles.map(b => b.chain)
    expect(id).not.toBe('')
    expect(config.bubbles.map(b => b.chain)).toEqual([id, id])
    expect(config.chains.map(c => c.id)).toEqual([id])
  })

  // Order is read off `right` and nothing else, so this is the assertion that the balloon
  // the author is handed selected is the one the composer will be stamped from.
  it('returns the sender, and the sender is member 0 — the right column', () => {
    const { config, index } = addSmsConversation(empty(), 6)
    const members = chainMembers(config.bubbles, config.bubbles[index].chain, 6)
    expect(members[0]).toBe(index)
    expect(members).toHaveLength(2)
  })

  it('places the recipient mirrored across the panel, at the same size and height', () => {
    const { config, index } = addSmsConversation(empty(), 6)
    const sender = config.bubbles[index]
    expect(config.bubbles[1]).toMatchObject({
      top: sender.top,
      width: sender.width,
      right: 100 - sender.right - sender.width,
    })
  })

  it('turns the recipient’s tail back the other way, so it points across the panel', () => {
    const { config, index } = addSmsConversation(empty(), 6)
    expect(config.bubbles[index].tail).toBe('down-left')
    expect(config.bubbles[1].tail).toBe('down-right')
  })

  // `content: 'input'` on the sender is the whole of "this conversation is live": it is
  // what turns the bottom row into a field a reader types into. The recipient's column
  // holds messages already sent, so cloning the field would put the reader on both sides.
  it('makes the sender a composer and leaves the recipient lettering', () => {
    const { config, index } = addSmsConversation(empty(), 6)
    expect(isComposerContent(config.bubbles[index].content)).toBe(true)
    expect(config.bubbles[1]).toMatchObject({ content: 'text', text: '' })
  })

  it('binds the conversation to the account’s real thread, with no authored transcript', () => {
    const { config } = addSmsConversation(empty(), 6)
    expect(config.chains[0]).toMatchObject({
      sms: true,
      rows: DEFAULT_CHAIN_ROWS,
      messages: [],
    })
  })

  it('does not mutate the config it was given', () => {
    const before = empty()
    addSmsConversation(before, 6)
    expect(before.bubbles).toHaveLength(0)
    expect(before.chains).toHaveLength(0)
  })

  it('gives a second conversation its own id, so the two do not share settings', () => {
    const first = addSmsConversation(empty(), 6)
    const { config } = addSmsConversation(first.config, 6)
    const ids = config.chains.map(c => c.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  // A conversation is one panel's — two balloons on different panels are never on screen
  // together, so a second one must not be adopted into the first's chain.
  it('keeps two conversations on two panels apart', () => {
    const first = addSmsConversation(empty(), 6)
    const { config } = addSmsConversation(first.config, 7)
    expect(chainMembers(config.bubbles, config.bubbles[0].chain, 6)).toHaveLength(2)
    expect(chainMembers(config.bubbles, config.bubbles[2].chain, 7)).toHaveLength(2)
    expect(config.bubbles[0].chain).not.toBe(config.bubbles[2].chain)
  })

  // Every coupling above has to survive a Save and a reload, because the working copy goes
  // through localStorage as JSON — and `hydrateConfig` rebuilds the chain list from the
  // bubbles rather than trusting the stored one.
  it('survives a round trip through the stored working copy', () => {
    const { config } = addSmsConversation(empty(), 6)
    expect(hydrateConfig(JSON.stringify(config))).toEqual(config)
  })

  it('leaves nothing for the author to finish — the panel needs only a picker', () => {
    const { config } = addSmsConversation(empty(), 6)
    expect(peerPickerOn(config.bubbles, 6)).toBe(-1)
    const withPicker = addPeerPicker(config, 6)
    expect(peerPickerOn(withPicker.config.bubbles, 6)).toBe(withPicker.index)
  })
})

describe('addPeerPicker', () => {
  it('adds a balloon the panel’s conversation can read a number off', () => {
    const { config, index } = addPeerPicker(empty(), 6)
    expect(config.bubbles[index].panel).toBe(6)
    expect(peerPickerOn(config.bubbles, 6)).toBe(index)
  })

  // `peerPickerOn` skips chain members on purpose — a picker *inside* a conversation is
  // picking something the conversation says, not who it is with — so the balloon that says
  // who must stay out of the chain however close to it it is drawn.
  it('leaves it outside the chain, which is what makes it findable', () => {
    const { config } = addSmsConversation(empty(), 6)
    const { config: withPicker, index } = addPeerPicker(config, 6)
    expect(withPicker.bubbles[index].chain).toBe('')
    expect(withPicker.bubbles[index].linkTo).toBeNull()
    expect(withPicker.chains).toHaveLength(1)
  })

  it('starts with no shortlist rather than a made-up number', () => {
    const { config, index } = addPeerPicker(empty(), 6)
    expect(config.bubbles[index].text).toBe('')
  })

  it('does not mutate the config it was given', () => {
    const before = empty()
    addPeerPicker(before, 6)
    expect(before.bubbles).toHaveLength(0)
  })
})
