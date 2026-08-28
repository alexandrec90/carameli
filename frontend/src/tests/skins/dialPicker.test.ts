import { describe, expect, it } from 'vitest'

import { dialBubbleOn } from '../../skins/comic-book/bubbleContent'
import {
  addDialled,
  appendDialKey,
  dialDigits,
  dialMatches,
  dialOptionIndex,
  dialOptions,
  dialRowValue,
  dialSeat,
  dialTurn,
  dialTyped,
} from '../../skins/comic-book/dialPicker'
import { formatPhoneInput } from '../../skins/comic-book/phoneInput'

// The pure half of the 'dial' content kind: the combobox model behind the drum — how a
// typed number narrows the shortlist, which row the drum is on, and how a dialled number
// joins the list — plus how a keypad press lands in the field and which balloon on a panel
// the pad types into. The component half is BubbleDial.test.tsx.

/** Just the fields `dialBubbleOn` reads, so a case is legible as the rule it tests. */
const b = (panel: number, chain: string, content: string) => ({ panel, chain, content })

describe('dialDigits', () => {
  it('keeps only what a telephone can dial', () => {
    expect(dialDigits('+1 (234) 567-9999')).toBe('12345679999')
  })

  it('keeps the two keypad symbols, which are dialable', () => {
    expect(dialDigits('*67 555')).toBe('*67555')
    expect(dialDigits('#31#')).toBe('#31#')
  })

  it('is empty for a name, so a label option matches nothing', () => {
    expect(dialDigits('Reception')).toBe('')
  })
})

describe('dialMatches', () => {
  const options = ['+1 234 567 9999', '(555) 000-1111', '(555) 000-2222', 'Reception']

  it('narrows to the options carrying the typed digits', () => {
    expect(dialMatches(options, '5550002')).toEqual(['(555) 000-2222'])
  })

  it('keeps every option a partly typed number could still become', () => {
    expect(dialMatches(options, '555')).toEqual(['(555) 000-1111', '(555) 000-2222'])
  })

  it('ignores how either side is punctuated', () => {
    // The author's option is spaced and the field is region-formatted; both are one number.
    expect(dialMatches(options, '(234) 567')).toEqual(['+1 234 567 9999'])
  })

  it('matches a national number against an option written internationally', () => {
    // Contains rather than starts-with: a shortlist and a keypad rarely agree on where a
    // number begins, and a prefix test would say these two are looking for each other.
    expect(dialMatches(options, '2345679999')).toEqual(['+1 234 567 9999'])
  })

  it('narrows nothing for a query with no digits in it, so a name list stays whole', () => {
    expect(dialMatches(options, '')).toEqual(options)
    expect(dialMatches(options, '  ')).toEqual(options)
  })

  it('is empty for a number nothing on the list carries', () => {
    expect(dialMatches(options, '9998887777')).toEqual([])
  })
})

describe('dialRowValue', () => {
  const matches = ['(555) 000-1111', '(555) 000-2222']

  it('is what the reader typed at row 0', () => {
    expect(dialRowValue({ query: '555', index: 0 }, matches)).toBe('555')
  })

  it('is the match a higher row names', () => {
    expect(dialRowValue({ query: '555', index: 2 }, matches)).toBe('(555) 000-2222')
  })

  it('falls back to the typed row rather than to nothing when a row has gone', () => {
    // The list can be re-filtered under an index; the reader's own number is always there.
    expect(dialRowValue({ query: '555', index: 9 }, matches)).toBe('555')
  })
})

describe('dialTurn', () => {
  const typed = { query: '555', index: 0 }

  it('moves down through the matches', () => {
    expect(dialTurn(typed, 2, 1)).toEqual({ query: '555', index: 1 })
    expect(dialTurn(typed, 2, 2)).toEqual({ query: '555', index: 2 })
  })

  it('stops at the last match rather than wrapping', () => {
    expect(dialTurn(typed, 2, 5)).toEqual({ query: '555', index: 2 })
  })

  it('turns back up onto the typed row, which is how the reader gets their number back', () => {
    expect(dialTurn({ query: '555', index: 1 }, 2, -1)).toEqual({ query: '555', index: 0 })
  })

  it('skips the typed row while nothing has been typed', () => {
    // Row 0 would be an empty field, which is not somewhere anybody asked to go.
    expect(dialTurn({ query: '', index: 1 }, 3, -1)).toEqual({ query: '', index: 1 })
  })

  it('leaves the typed row reachable when it is the only row', () => {
    expect(dialTurn({ query: '', index: 0 }, 0, -1).index).toBe(0)
  })

  it('returns the same state when nothing moved, so a caller can test identity', () => {
    const state = { query: '555', index: 2 }
    expect(dialTurn(state, 2, 1)).toBe(state)
  })
})

describe('dialTyped', () => {
  it('makes the typed number the filter and puts the drum back on it', () => {
    expect(dialTyped('(555) 000')).toEqual({ query: '(555) 000', index: 0 })
  })
})

describe('dialOptionIndex', () => {
  const options = ['+1 234 567 9999', '(555) 000-1111', 'Reception']

  it('finds the option a value is, however either is punctuated', () => {
    expect(dialOptionIndex(options, '1 (234) 567-9999')).toBe(0)
    expect(dialOptionIndex(options, '5550001111')).toBe(1)
  })

  it('is -1 for a number part-way typed, unlike dialMatches', () => {
    expect(dialOptionIndex(options, '1 (234)')).toBe(-1)
  })

  it('is -1 for a number the author never listed', () => {
    expect(dialOptionIndex(options, '9999999999')).toBe(-1)
  })

  it('is -1 for an empty field rather than matching a label option', () => {
    // 'Reception' has no digits either, and an empty field must not turn the drum to it.
    expect(dialOptionIndex(options, '')).toBe(-1)
    expect(dialOptionIndex(options, '   ')).toBe(-1)
  })

  it('is -1 with no options at all', () => {
    expect(dialOptionIndex([], '5550001111')).toBe(-1)
  })
})

describe('dialSeat', () => {
  const options = ['2345679999', '5550001111']

  it('seats a listed number on its own row with the filter cleared', () => {
    // Cleared on purpose: the whole shortlist is there to turn through from a row of it.
    expect(dialSeat(options, '(555) 000-1111')).toEqual({ query: '', index: 2 })
  })

  it('leaves an unlisted number as the reader’s own typed row', () => {
    expect(dialSeat(options, '(999) 888-7777')).toEqual({ query: '(999) 888-7777', index: 0 })
  })

  it('seats an empty field on the typed row, filtering nothing', () => {
    expect(dialSeat(options, '')).toEqual({ query: '', index: 0 })
  })
})

describe('appendDialKey', () => {
  it('formats a keypad press exactly as typing the same digit would', () => {
    expect(appendDialKey('123456799', '9', 'US')).toBe(formatPhoneInput('1234567999', 'US'))
  })

  it('grows a number one key at a time from empty', () => {
    const keys = ['2', '3', '4', '5', '6', '7', '9', '9', '9', '9']
    expect(keys.reduce((acc, key) => appendDialKey(acc, key, 'US'), '')).toBe('(234) 567-9999')
  })

  it('keeps a star or hash the reader punched in', () => {
    // libphonenumber drops both, so an unguarded format made those two keys look dead.
    expect(appendDialKey('', '*', 'US')).toBe('*')
    expect(appendDialKey('*6', '7', 'US')).toBe('*67')
    expect(appendDialKey('31', '#', 'US')).toBe('31#')
  })
})

describe('addDialled', () => {
  it('records a number that was dialled', () => {
    expect(addDialled([], '(555) 000-1111')).toEqual(['(555) 000-1111'])
  })

  it('does not record the same number twice, however it was spelled the second time', () => {
    expect(addDialled(['(555) 000-1111'], '5550001111')).toEqual(['(555) 000-1111'])
  })

  it('records nothing dialable as nothing, since that was not a call', () => {
    expect(addDialled([], '   ')).toEqual([])
  })

  it('never mutates the list it was given', () => {
    const dialled = ['(555) 000-1111']
    expect(addDialled(dialled, '5550002222')).not.toBe(dialled)
    expect(dialled).toEqual(['(555) 000-1111'])
  })
})

describe('dialOptions', () => {
  it('puts what was dialled after what the author listed, oldest first', () => {
    // After, because the author's list is the drawing and the redials are what happened
    // to it — and a row that moved every time somebody called it would never settle.
    expect(dialOptions(['2345679999'], ['(555) 000-1111', '(555) 000-2222'])).toEqual([
      '2345679999',
      '(555) 000-1111',
      '(555) 000-2222',
    ])
  })

  it('does not list a number twice when the author had it already', () => {
    expect(dialOptions(['2345679999'], ['(234) 567-9999'])).toEqual(['2345679999'])
  })

  it('keeps a label option, which no dialled number can collide with', () => {
    expect(dialOptions(['Reception'], ['(555) 000-1111'])).toEqual([
      'Reception',
      '(555) 000-1111',
    ])
  })

  it('is the author’s list alone before anything has been dialled', () => {
    expect(dialOptions(['2345679999'], [])).toEqual(['2345679999'])
  })
})

describe('formatPhoneInput with keypad symbols', () => {
  it('passes a number containing * or # through untouched', () => {
    expect(formatPhoneInput('*67', 'US')).toBe('*67')
    expect(formatPhoneInput('#31#5551111', 'US')).toBe('#31#5551111')
  })

  it('still formats an ordinary number', () => {
    expect(formatPhoneInput('2345679999', 'US')).toBe('(234) 567-9999')
  })
})

describe('dialBubbleOn', () => {
  it('finds the panel’s dial balloon', () => {
    expect(dialBubbleOn([b(0, '', 'wheel'), b(0, '', 'dial')], 0)).toBe(1)
  })

  it('finds a dial that carries a call key too', () => {
    // The projected keypad types into a 'dial-call' the same way: the key is beside the
    // field, not instead of it.
    expect(dialBubbleOn([b(0, '', 'wheel'), b(0, '', 'dial-call')], 0)).toBe(1)
  })

  it('is -1 on a panel whose picker is a plain wheel', () => {
    // The projected keypad has nothing to type into there, so it keeps its old handler.
    expect(dialBubbleOn([b(0, '', 'wheel')], 0)).toBe(-1)
  })

  it('ignores a dial belonging to another panel', () => {
    expect(dialBubbleOn([b(1, '', 'dial')], 0)).toBe(-1)
  })

  it('ignores a dial that is itself part of a chain', () => {
    expect(dialBubbleOn([b(0, 'chain-1', 'dial')], 0)).toBe(-1)
  })

  it('takes the first free one, since a panel dials one number at a time', () => {
    expect(dialBubbleOn([b(0, 'chain-1', 'dial'), b(0, '', 'dial'), b(0, '', 'dial')], 0)).toBe(1)
  })

  it('is -1 for an empty page', () => {
    expect(dialBubbleOn([], 0)).toBe(-1)
  })
})
