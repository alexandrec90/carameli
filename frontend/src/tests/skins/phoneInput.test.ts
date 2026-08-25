import { describe, expect, it } from 'vitest'

import {
  caretAfterDigits,
  countryFromLocales,
  deleteAdjacentDigit,
  digitsBefore,
  formatPhoneInput,
} from '../../skins/comic-book/phoneInput'

describe('countryFromLocales', () => {
  it('uses an explicit region from the first supported browser locale', () => {
    expect(countryFromLocales(['fr-CA', 'en-US'])).toBe('CA')
  })

  it('maximizes a language-only locale and skips malformed or unsupported regions', () => {
    expect(countryFromLocales(['not_a_locale', 'en-EU', 'fr'])).toBe('FR')
  })
})

describe('formatPhoneInput', () => {
  it('formats national input for the detected region as the user types', () => {
    expect(formatPhoneInput('12345679999', 'US')).toBe('1 (234) 567-9999')
    expect(formatPhoneInput('0612345678', 'FR')).toBe('06 12 34 56 78')
  })

  it('lets an international prefix override the detected region', () => {
    expect(formatPhoneInput('+442071838750', 'US')).toBe('+44 20 7183 8750')
  })

  it('normalizes author-typed punctuation instead of preserving it literally', () => {
    expect(formatPhoneInput('(234).567--9999', 'US')).toBe('(234) 567-9999')
  })
})

describe('phone caret helpers', () => {
  it('maps the caret by digit count across inserted punctuation', () => {
    const formatted = '(234) 567-9999'
    expect(digitsBefore(formatted, 9)).toBe(6)
    expect(caretAfterDigits(formatted, 6)).toBe(9)
    expect(caretAfterDigits('+1 23', 0)).toBe(1)
  })

  it('backspaces the previous digit across formatter-owned punctuation', () => {
    expect(deleteAdjacentDigit('(234) 567-9999', 6, 'backward')).toEqual({
      value: '(23) 567-9999',
      digitsBefore: 2,
    })
  })

  it('deletes the next digit across formatter-owned punctuation', () => {
    expect(deleteAdjacentDigit('(234) 567-9999', 5, 'forward')).toEqual({
      value: '(234) 67-9999',
      digitsBefore: 3,
    })
    expect(deleteAdjacentDigit('', 0, 'forward')).toBeNull()
  })
})
