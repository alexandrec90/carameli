import { formatIncompletePhoneNumber, isSupportedCountry } from 'libphonenumber-js/min'
import type { CountryCode } from 'libphonenumber-js/min'

/** Infer a numbering region from an ordered browser-language list. */
export function countryFromLocales(locales: readonly string[]): CountryCode | undefined {
  for (const locale of locales) {
    try {
      const parsed = new Intl.Locale(locale)
      const region = parsed.region ?? parsed.maximize().region
      if (region && isSupportedCountry(region)) return region
    } catch {
      // A malformed preference should not hide the next usable locale.
    }
  }
  return undefined
}

/** The browser's best privacy-preserving region hint; international `+` input wins. */
export function browserCountry(): CountryCode | undefined {
  if (typeof navigator === 'undefined') return undefined
  const locales = navigator.languages?.length ? navigator.languages : [navigator.language]
  return countryFromLocales(locales)
}

/** Format a partial number as it is typed, using `country` for national input. */
export function formatPhoneInput(value: string, country?: CountryCode): string {
  return formatIncompletePhoneNumber(value, country)
}

/** Count digits to the left of a caret, ignoring formatter-owned punctuation. */
export function digitsBefore(value: string, caret: number): number {
  return (value.slice(0, caret).match(/[0-9]/g) ?? []).length
}

/** Place a caret after the same number of digits in a newly formatted value. */
export function caretAfterDigits(value: string, count: number): number {
  if (count <= 0) return value.startsWith('+') ? 1 : 0
  let seen = 0
  for (let i = 0; i < value.length; i += 1) {
    if (/[0-9]/.test(value[i])) seen += 1
    if (seen === count) return i + 1
  }
  return value.length
}

export interface DigitDeletion {
  value: string
  digitsBefore: number
}

/**
 * Delete the adjacent digit rather than a formatter-owned bracket, dash or space.
 * Returns null when there is no digit in that direction, leaving native editing to
 * handle a leading `+` or an empty value.
 */
export function deleteAdjacentDigit(
  value: string,
  caret: number,
  direction: 'backward' | 'forward',
): DigitDeletion | null {
  const step = direction === 'backward' ? -1 : 1
  let index = direction === 'backward' ? caret - 1 : caret
  while (index >= 0 && index < value.length && !/[0-9]/.test(value[index])) index += step
  if (index < 0 || index >= value.length) return null
  return {
    value: value.slice(0, index) + value.slice(index + 1),
    digitsBefore: digitsBefore(value, index),
  }
}
