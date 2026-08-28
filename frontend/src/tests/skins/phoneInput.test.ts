import { describe, expect, it } from 'vitest'

import {
  caretAfterDigits,
  countryFromLocales,
  deleteAdjacentDigit,
  digitsBefore,
  formatPhoneInput,
  toE164,
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

describe('toE164', () => {
  // What an author writes in a wheel picker becomes what a request sends. The same
  // number written three ways has to collapse to one string, or the same thread is
  // three threads depending on the lettering.
  it('rewrites a nationally written number into E.164 for the detected region', () => {
    expect(toE164('(415) 555-1111', 'US')).toBe('+14155551111')
    expect(toE164('415 555 1111', 'US')).toBe('+14155551111')
  })

  it('leaves an already international number alone, region or no region', () => {
    expect(toE164('+1 415 555 1111')).toBe('+14155551111')
    expect(toE164('+44 20 7183 8750', 'US')).toBe('+442071838750')
  })

  it('returns null for an option that is not a number at all', () => {
    // A picker of names is an ordinary comic balloon, so this is not an error path.
    expect(toE164('Gwen', 'US')).toBeNull()
    expect(toE164('', 'US')).toBeNull()
  })

  it('returns null for digits too few to be a number in the region', () => {
    expect(toE164('415 555', 'US')).toBeNull()
    expect(toE164('+1 000', 'US')).toBeNull()
  })

  it('gives an invented number its own identity, rather than none', () => {
    // These parse and are the right length, and libphonenumber calls them *invalid*
    // because no carrier was ever assigned that range. That answer is about whether a
    // message would arrive; this function is asked which conversation a number is. A
    // reader trying two made-up numbers is trying two conversations, and returning null
    // for both made them share one — see the note on `toE164`.
    expect(toE164('(555) 555-5555', 'US')).toBe('+15555555555')
    expect(toE164('(123) 123-1234', 'US')).toBe('+11231231234')
    expect(toE164('(555) 555-5555', 'US')).not.toBe(toE164('(123) 123-1234', 'US'))
  })

  it('returns null for a national number with no region to read it against', () => {
    expect(toE164('4155551111')).toBeNull()
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
