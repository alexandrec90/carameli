import {
  formatIncompletePhoneNumber as formatIncomplete,
  isSupportedCountry as isSupported,
  parsePhoneNumberFromString as parseFromString,
} from 'libphonenumber-js/core'
import type { CountryCode, MetadataJson } from 'libphonenumber-js/core'

import metadata from '../../lib/phoneMetadata.json'

// `/core` rather than `/min`, and the difference is the whole point: `/min` bundles every
// numbering plan on earth (82 KB, 60% of it leading-digit regexes), `/core` takes the
// table as an argument. `frontend/phoneMetadata.ts` says which plans that table holds and
// why, `phoneMetadataGen.ts` writes it, and `phoneMetadata.test.ts` fails when the
// committed file is stale. The three calls are wrapped here rather than at each site so
// that the extra argument stays one file's business.
//
// **What a visitor loses for a plan whose formats are not carried: the formats.** Every
// one of the 245 plans keeps the fields that decide *what number this is*, so `toE164`
// answers exactly what it always did — internationally written or nationally, trunk
// prefix and all. A trimmed plan only comes out of the as-you-type formatter ungrouped.
//
// That is a deliberate line and an easy one to erase by accident: trimming a plan to the
// four fields E.164 obviously needs turns a Nigerian `08031234567` into
// `+23408031234567`, because the rule that strips the trunk `0` lives further along the
// entry. `phoneMetadata.ts` carries the full account and
// `src/tests/skins/phoneInput.test.ts` holds the line with real numbers.

// The table is JSON, so TypeScript infers its literal shape rather than the package's;
// one assertion here beats one at every call.
const md = metadata as unknown as MetadataJson

const formatIncompletePhoneNumber = (value: string, country?: CountryCode): string =>
  formatIncomplete(value, country, md)

/**
 * A predicate rather than a boolean, matching the signature `libphonenumber-js/min`
 * exported: it is what narrows a browser locale's region string to a `CountryCode`, and
 * without it every caller would need a cast that asserts what this already checked.
 */
const isSupportedCountry = (country: string): country is CountryCode =>
  isSupported(country as CountryCode, md)

// `{ defaultCountry }` rather than the bare country, because `/core`'s overloads have no
// spelling for an undefined second argument and this reads as what it is: a default, used
// only when the value does not name a country itself.
const parsePhoneNumberFromString = (value: string, country?: CountryCode) =>
  parseFromString(value, { defaultCountry: country }, md)

/**
 * Infer a numbering region from an ordered browser-language list.
 *
 * Every plan the full table has is still supported here, trimmed or not, because a region
 * that cannot be a default country is a region whose visitors cannot type their own
 * number. What a trimmed region gets is a correct E.164 and no grouping.
 */
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

/**
 * A written number in the E.164 form an API takes, or null when it is not a number at all.
 *
 * This is the join between what an author *writes* and what a request *sends*: a wheel
 * picker's options are lettering in a comic panel — `(555) 010-4477`, `+1 555 010 4477` —
 * and the same option has to become one canonical string, or the same conversation is two
 * conversations depending on how it was typed. Null rather than a throw, because an option
 * that is a person's name is an ordinary thing for a panel to hold and not an error.
 *
 * **The test is `isPossible`, not `isValid`, and the difference is the whole point.**
 * `isValid` asks whether a number is in an assigned range of a real numbering plan, which
 * every made-up number fails: `(555) 555-5555` and `(123) 123-1234` parse perfectly and are
 * not valid, so this returned null for them. That null then travelled — it left a chain
 * *unbound*, which is a composer wired to nothing, and every invented number shared the one
 * fallback transcript that state left behind. So a reader trying two numbers of their own
 * got one conversation that followed them from number to number, and neither number was
 * ever a thread that could be returned to.
 *
 * Identity is what this function is for, and an invented number still has one. `isPossible`
 * keeps out what is genuinely not a destination — a name, a half-typed number — and lets
 * every number-shaped thing be its own conversation. Whether a carrier will *accept* it is
 * the carrier's answer to give, on a message that visibly fails, rather than something to
 * settle here by silently pretending the number was never dialled.
 *
 * **The trimmed metadata changes nothing here, by construction.** Every plan keeps the
 * fields identity is decided by, so this answers for all 245 exactly as it did when the
 * bundle carried all of them — see the note at the top of this file, and
 * `frontend/phoneMetadata.ts` for what is actually dropped. If that ever stops being true
 * the repair is to carry more fields, never to make this asynchronous: a *maybe* returned
 * here is a chain bound to the wrong thread, which is the failure above by another name.
 */
export function toE164(value: string, country?: CountryCode): string | null {
  const parsed = parsePhoneNumberFromString(value, country)
  return parsed?.isPossible() ? parsed.number : null
}

/** Anything a telephone keypad has that a written number does not. */
const KEYPAD_SYMBOL = /[*#]/

/**
 * Format a partial number as it is typed, using `country` for national input.
 *
 * A value carrying `*` or `#` is passed through untouched. `formatIncompletePhoneNumber`
 * *silently deletes* both — they are not part of any numbering plan — so a reader
 * pressing the `*` key on a projected keypad watched the press do nothing at all, which
 * reads as a broken key rather than as a formatter with an opinion. Those two are real
 * keys on the phone in the picture, and a value holding one has stopped being a number
 * to format anyway.
 *
 * This is the one function the trimmed metadata is visible in: a plan whose formats are
 * not carried comes back ungrouped rather than spaced. The digits are never altered, so
 * what a visitor sees is their own number, plainer. See `frontend/phoneMetadata.ts`.
 */
export function formatPhoneInput(value: string, country?: CountryCode): string {
  if (KEYPAD_SYMBOL.test(value)) return value
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
