import type { CountryCode } from 'libphonenumber-js/min'

import { formatPhoneInput } from './phoneInput'

// The pure half of the 'dial' content kind: a wheel picker whose current option is also
// a real phone field. BubbleDial.tsx is the DOM shell over this and over wheelPicker.ts,
// which still owns the drum arithmetic — a dial turns exactly like a wheel and differs
// only in what the picked row is made of.
//
// Named for the picker rather than for the balloon, like wheelPicker.ts beside
// BubbleWheel.tsx, and it has to be: `bubbleDial.ts` differs from `BubbleDial.tsx` only in
// case, and on Windows and macOS an extensionless `./BubbleDial` then resolves to *this*
// file — `.ts` is tried before `.tsx` — so every import of the component silently became
// an import of a module with no default export.

/**
 * A dialled value reduced to what a keypad actually produced: digits plus `*` and `#`,
 * with every character the formatter added — brackets, dashes, spaces, a leading `+` —
 * thrown away.
 *
 * This is the comparison key, not a canonical number: `toE164` (phoneInput.ts) is what
 * turns a value into the one string an API takes. Two spellings of the same national
 * number match here; a national and an international spelling of it do not, which is the
 * right answer for "is the drum showing what the field says", where the drum is showing
 * one of the author's own options verbatim.
 */
export function dialDigits(value: string): string {
  return value.replace(/[^0-9*#]/g, '')
}

/**
 * Which option the field's current value *is*, or -1 when it is not one of them.
 *
 * The drum and the field are two views of one value, so this is what keeps them
 * agreeing when the value was changed by the half that does not move the drum: type an
 * option's own number and the drum turns to it. An empty field matches nothing rather
 * than matching an empty option, which `splitOptions` cannot produce anyway.
 */
export function dialOptionIndex(options: readonly string[], value: string): number {
  const key = dialDigits(value)
  if (key === '') return -1
  return options.findIndex(option => dialDigits(option) === key)
}

/**
 * Add one projected-keypad press to the dialled value.
 *
 * Formatting on every press rather than only on blur is what makes the pad and the
 * keyboard the same field: both routes end in a formatted string, so neither can leave
 * the other looking at a value it would not have produced. `formatPhoneInput` is
 * idempotent, and passes a value carrying `*` or `#` through untouched.
 */
export function appendDialKey(value: string, key: string, country?: CountryCode): string {
  return formatPhoneInput(value + key, country)
}
