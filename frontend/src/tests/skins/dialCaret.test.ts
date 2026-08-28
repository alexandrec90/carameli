import { describe, expect, it } from 'vitest'

import { dialCaretLeft, dialCaretShown } from '../../skins/comic-book/dialCaret'

// The comic caret's pure half (dialCaret.ts): when it shows, and where it stands.
// The DOM half — measuring the field's font, listening for the selection moving —
// is useDialCaret.ts, exercised through BubbleDial.test.tsx.

describe('dialCaretShown', () => {
  it('shows for a focused field lettering the reader’s own number, caret collapsed', () => {
    expect(dialCaretShown(true, false, 3, 3)).toBe(true)
  })

  it('hides over a fresh, drum-supplied number, which the next key replaces whole', () => {
    // A caret promises an insertion; over a finished number there is none to promise.
    expect(dialCaretShown(true, true, 3, 3)).toBe(false)
  })

  it('hides when the field is not focused, wherever the caret sits', () => {
    expect(dialCaretShown(false, false, 3, 3)).toBe(false)
  })

  it('hides across a range selection, whose ink is the marker swipe instead', () => {
    expect(dialCaretShown(true, false, 0, 5)).toBe(false)
  })

  it('hides when the control reports no selection at all', () => {
    expect(dialCaretShown(true, false, null, null)).toBe(false)
  })
})

describe('dialCaretLeft', () => {
  it('stands at the centred line’s left edge plus the width before the caret', () => {
    // Content 100 wide holding 40 of text: the line starts 30 in from the 10 of
    // padding, and the caret follows the 15 of lettering that precedes it.
    expect(dialCaretLeft(10, 100, 40, 15)).toBe(55)
  })

  it('sits mid-window over an empty field, where the first digit will land', () => {
    expect(dialCaretLeft(0, 100, 0, 0)).toBe(50)
  })
})
