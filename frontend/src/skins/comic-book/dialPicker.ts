import type { CountryCode } from 'libphonenumber-js/min'

import { formatPhoneInput } from './phoneInput'

// The pure half of the 'dial' content kind: an autocomplete whose list is a wheel.
// BubbleDial.tsx is the DOM shell over this and over wheelPicker.ts, which still owns the
// drum arithmetic — a dial turns exactly like a wheel and differs only in what its rows
// are and in where they come from.
//
// The model is a combobox, not a picker with a field beside it. There is one window, and
// its rows are:
//
//   row 0        what the reader typed — drawn by the field, so the drum leaves it blank
//   rows 1..n    the options that number narrows to (`dialMatches`)
//
// which is why `index` is offset by one throughout. Typing re-filters and returns the
// drum to row 0; turning moves through the matches and lettering the field with the one
// it lands on; turning back up to row 0 gives the reader their own number again. That
// last property is what makes the typed row a row rather than a mode: there is exactly
// one gesture for moving between what you typed and what was offered.
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

/** Where the drum is, and what it is filtered by. See the module comment for the rows. */
export interface DialState {
  /**
   * The number as the reader last typed or punched it — the filter, and the value of
   * row 0. Empty means nothing has been typed, so nothing is filtered out.
   */
  query: string
  /** 0 for the typed row; 1..matches.length for a match. */
  index: number
}

/**
 * The options `query` narrows to: those whose dialable digits *contain* the query's.
 *
 * Contains rather than starts-with, because a shortlist and a keypad rarely agree on
 * where a number begins — an option written `+1 234 567 9999` and a reader typing the
 * national `234…` are looking for each other, and a prefix test would say they are not.
 * A query with no digits at all (empty, or punctuation part-typed) narrows nothing,
 * which is also what keeps a shortlist of *names* usable: it stays whole.
 */
export function dialMatches(options: readonly string[], query: string): string[] {
  const key = dialDigits(query)
  if (key === '') return options.slice()
  return options.filter(option => dialDigits(option).includes(key))
}

/** The number row `state.index` names: the reader's own at row 0, a match above it. */
export function dialRowValue(state: DialState, matches: readonly string[]): string {
  if (state.index <= 0) return state.query
  return matches[state.index - 1] ?? state.query
}

/**
 * The lowest row the drum can reach.
 *
 * Row 0 is the reader's own number, so it is only somewhere to go back *to* — with an
 * empty query there is nothing there, and turning up off the first match would blank the
 * field for no reason anybody asked for. So the typed row is skipped until something has
 * been typed, unless there are no matches at all, in which case it is the only row.
 */
function dialFloor(state: DialState, matchCount: number): number {
  return state.query === '' && matchCount > 0 ? 1 : 0
}

/**
 * Turn the drum `steps` rows. Stops at the ends rather than wrapping, matching what a
 * physical drum does — and what `wheelPicker`'s own clamp does for a plain wheel.
 *
 * Returns the same object when nothing moved, so a caller can use identity to decide
 * whether it has a new number to report.
 */
export function dialTurn(state: DialState, matchCount: number, steps: number): DialState {
  const floor = dialFloor(state, matchCount)
  const index = Math.min(Math.max(state.index + steps, floor), matchCount)
  return index === state.index ? state : { query: state.query, index }
}

/**
 * The state a freshly typed — or punched-in — number puts the drum in: that number
 * becomes the filter, and the drum returns to the row drawn by the field.
 */
export function dialTyped(value: string): DialState {
  return { query: value, index: 0 }
}

/**
 * Which option the value *is*, or -1 when it is not one of them. Exact, unlike
 * `dialMatches`: this asks "is the drum showing this very option", not "could it".
 */
export function dialOptionIndex(options: readonly string[], value: string): number {
  const key = dialDigits(value)
  if (key === '') return -1
  return options.findIndex(option => dialDigits(option) === key)
}

/**
 * Seat the drum on a value that arrived from outside the picker — the option a balloon
 * starts on, or a number that has just been dialled onto the shortlist.
 *
 * A value that is on the list is shown as that row with the filter cleared, so the whole
 * shortlist is there to turn through; one that is not stays the reader's own typed row.
 */
export function dialSeat(options: readonly string[], value: string): DialState {
  const listed = dialOptionIndex(options, value)
  return listed >= 0 ? { query: '', index: listed + 1 } : dialTyped(value)
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

/**
 * Record a number that was actually dialled, so the shortlist grows into a redial list.
 *
 * A number already on it is not added twice, and a value with nothing dialable in it is
 * not added at all — pressing Enter on an empty field is not a call.
 */
export function addDialled(dialled: readonly string[], value: string): string[] {
  const key = dialDigits(value)
  if (key === '' || dialled.some(d => dialDigits(d) === key)) return dialled.slice()
  return [...dialled, value]
}

/**
 * The shortlist a dial balloon actually shows: what the author listed, then what the
 * reader has dialled that the author did not list, oldest first.
 *
 * After the author's own options rather than before them, because the author's list is
 * the drawing and the redials are what happened to it — and because an option moving
 * every time somebody calls it would make the balloon's own lettering unstable.
 */
export function dialOptions(
  authored: readonly string[],
  dialled: readonly string[],
): string[] {
  const listed = new Set(authored.map(dialDigits).filter(key => key !== ''))
  return [...authored, ...dialled.filter(d => !listed.has(dialDigits(d)))]
}
