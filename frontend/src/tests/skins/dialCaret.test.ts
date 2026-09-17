import { describe, expect, it } from 'vitest'

import {
  caretLineIndex, caretLineTop, dialCaretLeft, dialCaretShown, wrapCaretLines,
} from '../../skins/comic-book/dialCaret'

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

// The composer's half: a field whose words wrap has a *line* to find as well as a place
// along it. Measured in a fake font of one unit a character, so the assertions are about
// where the breaks fall rather than about any real lettering.
describe('wrapCaretLines', () => {
  /** Every character one unit wide — a line `width` units long holds `width` of them. */
  const monospace = (run: string): number => run.length

  it('leaves text that fits on one line alone', () => {
    expect(wrapCaretLines('hi there', 20, monospace)).toEqual([{ start: 0, text: 'hi there' }])
  })

  it('gives an empty field one empty line for the caret to stand on', () => {
    expect(wrapCaretLines('', 20, monospace)).toEqual([{ start: 0, text: '' }])
  })

  it('breaks at the last space that fits, and starts the next line past it', () => {
    expect(wrapCaretLines('aaa bbb ccc', 7, monospace)).toEqual([
      { start: 0, text: 'aaa bbb' },
      { start: 8, text: 'ccc' },
    ])
  })

  // `overflow-wrap: anywhere`: a word with nowhere to break breaks inside itself rather
  // than running out past the edge — the same rule the fit assumes of the drawing.
  it('breaks inside a word too long for a line of its own', () => {
    expect(wrapCaretLines('aaaaaaaa', 3, monospace)).toEqual([
      { start: 0, text: 'aaa' },
      { start: 3, text: 'aaa' },
      { start: 6, text: 'aa' },
    ])
  })

  // Browsers hang a trailing space past the edge and leave it out of the centring, so a
  // line is never broken by one and never measured with one.
  it('hangs a trailing space rather than breaking the line for it', () => {
    expect(wrapCaretLines('aaa ', 3, monospace)).toEqual([{ start: 0, text: 'aaa' }])
  })

  it('covers the whole value, in order, with no character lost between lines', () => {
    const value = 'the quick brown fox jumps over it'
    const lines = wrapCaretLines(value, 9, monospace)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(monospace(line.text)).toBeLessThanOrEqual(9)
      expect(value.startsWith(line.text, line.start)).toBe(true)
    }
    expect(lines.map(l => l.start)).toEqual([...lines.map(l => l.start)].sort((a, b) => a - b))
  })
})

describe('caretLineIndex', () => {
  const lines = [
    { start: 0, text: 'aaa bbb' },
    { start: 8, text: 'ccc' },
  ]

  it('finds the line the caret is inside', () => {
    expect(caretLineIndex(lines, 0)).toBe(0)
    expect(caretLineIndex(lines, 5)).toBe(0)
    expect(caretLineIndex(lines, 9)).toBe(1)
  })

  // A caret at a wrap belongs to the new line: that is where the next character typed
  // appears, and a caret promises the next keystroke.
  it('takes the head of the new line at a wrap, not the end of the old one', () => {
    expect(caretLineIndex(lines, 8)).toBe(1)
  })

  it('stays on the last line past the end of the value', () => {
    expect(caretLineIndex(lines, 99)).toBe(1)
  })
})

describe('caretLineTop', () => {
  it('drops the caret a whole line for each line above it, under the padding', () => {
    expect(caretLineTop(4, 18, 0)).toBe(4)
    expect(caretLineTop(4, 18, 2)).toBe(40)
  })
})
