import { describe, expect, it } from 'vitest'

import { BUBBLE_CONTENT_KINDS } from '../../skins/comic-book/bubbleContent'
import { CHAIN_HINT, CONTENT_HINTS, linkHint } from '../../skins/comic-book/editor/bubbleHints'
import {
  BOUND_HINT, columnHint, rowsHint, transcriptSummary,
} from '../../skins/comic-book/editor/chainHints'

// The inspector's prose, now that it is data rather than markup.
//
// Moving it out of the components was what let the toolbar stop covering the page — each
// paragraph is a `?` on a line that already exists — and it is what makes these testable
// at all: a `{n === 1 ? '' : 's'}` inlined in JSX can only be checked by rendering the
// thing that contains it.

describe('bubble content hints', () => {
  it('says something specific for every kind whose text is not just lettering', () => {
    for (const kind of ['wheel', 'dial', 'dial-call', 'input', 'phone', 'actions',
      'transcript', 'number-hangup'] as const) {
      expect(CONTENT_HINTS[kind], `no hint for ${kind}`).toBeTruthy()
    }
  })

  // Plain lettering has nothing to explain, and an empty string would still draw a badge.
  it('leaves plain text without a badge at all', () => {
    expect(CONTENT_HINTS.text).toBeUndefined()
  })

  // Read off the union rather than a list here, so a content kind added next year is
  // held to the same rule the day it lands.
  it('offers a hint only for kinds the skin actually has', () => {
    for (const kind of Object.keys(CONTENT_HINTS)) {
      expect(BUBBLE_CONTENT_KINDS, `${kind} is not a content kind`).toContain(kind)
    }
  })

  // `dial-call` is `dial` plus a green key, and the wording says so rather than
  // paraphrasing it — the two used to be one paragraph with a conditional tail.
  it('describes the call button as an addition to the dial, not a different thing', () => {
    expect(CONTENT_HINTS['dial-call']).toContain(CONTENT_HINTS.dial as string)
    expect(CONTENT_HINTS['dial-call']).toMatch(/green key/)
  })

  it('names the panel a balloon has nothing to link to', () => {
    expect(linkHint('Notepad')).toContain('Notepad')
  })

  it('keeps the chain and bound-thread warnings distinct', () => {
    expect(CHAIN_HINT).toMatch(/one column of a conversation/)
    expect(BOUND_HINT).toMatch(/sends one for money/)
  })
})

describe('chain hints', () => {
  it('tells the two columns apart', () => {
    expect(columnHint(true, false)).toMatch(/^The sender/)
    expect(columnHint(false, false)).toMatch(/^The recipient/)
  })

  // A live sender's bottom row *is* the composer; an inert one has to be told how to
  // become one. Getting these the wrong way round is the mistake worth catching.
  it('tells a live sender what its composer does, and an inert one how to get one', () => {
    expect(columnHint(true, true)).toMatch(/bottom row is the composer/)
    expect(columnHint(true, false)).toMatch(/Give it `input` content/)
  })

  it('says the same thing about templates whichever column is selected', () => {
    for (const hint of [columnHint(true, true), columnHint(true, false), columnHint(false, true)]) {
      expect(hint).toMatch(/stamped from this balloon/)
    }
  })

  it('adds the growth wording only where a conversation actually grows', () => {
    expect(rowsHint(true)).toMatch(/grows by one row per message/)
    expect(rowsHint(false)).not.toMatch(/grows by one row/)
    expect(rowsHint(false)).toMatch(/dashed frame/)
  })
})

describe('transcriptSummary', () => {
  it('counts messages, sides and rows', () => {
    expect(transcriptSummary(3, 1, 4, false)).toBe(
      '3 messages — 1 sent, 2 received — through 4 rows.',
    )
  })

  it('says "message" and "row" in the singular', () => {
    expect(transcriptSummary(1, 1, 1, false)).toBe(
      '1 message — 1 sent, 0 received — through 1 row.',
    )
  })

  it('mentions the composer only on a live conversation', () => {
    expect(transcriptSummary(2, 1, 3, true)).toContain('(the bottom row is the composer)')
    expect(transcriptSummary(2, 1, 3, false)).not.toContain('composer')
  })

  // The one fact about these numbers an author cannot read off the page: more messages
  // than rows is not an error, it is a scroll.
  it('says where the overflow went when the transcript outruns the window', () => {
    expect(transcriptSummary(9, 4, 4, false)).toMatch(/the wheel scrolls the rest into view\.$/)
    expect(transcriptSummary(4, 2, 4, false)).toMatch(/rows\.$/)
  })
})
