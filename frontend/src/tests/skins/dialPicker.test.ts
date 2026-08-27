import { describe, expect, it } from 'vitest'

import { dialBubbleOn } from '../../skins/comic-book/bubbleContent'
import { appendDialKey, dialDigits, dialOptionIndex } from '../../skins/comic-book/dialPicker'
import { formatPhoneInput } from '../../skins/comic-book/phoneInput'

// The pure half of the 'dial' content kind: how a typed number is matched back to an
// option, how a keypad press lands in the field, and which balloon on a panel the pad
// types into. The component half is BubbleDial.test.tsx.

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

describe('dialOptionIndex', () => {
  const options = ['+1 234 567 9999', '(555) 000-1111', 'Reception']

  it('finds the option a value is, however either is punctuated', () => {
    // The drum and the field must never letter two different numbers, and they are
    // written differently: the author's option is spaced, the field is region-formatted.
    expect(dialOptionIndex(options, '1 (234) 567-9999')).toBe(0)
    expect(dialOptionIndex(options, '5550001111')).toBe(1)
  })

  it('is -1 for a number part-way typed', () => {
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
