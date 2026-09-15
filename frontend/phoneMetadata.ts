/**
 * Which numbering plans the comic-book skin ships, and how the shipped file is built.
 *
 * `libphonenumber-js` carries every numbering plan on earth — 245 countries, 82 KB of
 * JSON — and the skin imported all of it to format and canonicalise phone numbers. That
 * was 64.9 KB of the lazy `comic-book` chunk: twice what the dev editor cost, and the
 * largest single thing in it by a wide margin. This file names the plans worth carrying
 * and {@link subsetMetadata} builds the smaller table, which
 * `src/lib/phoneMetadata.json` holds and `phoneInput.ts` hands to
 * `libphonenumber-js/core`.
 *
 * ## Why the table is so large in the first place, since the obvious guess is wrong
 *
 * It is not a list of display formats. 60% of those 82 KB are the *leading-digit regexes*
 * that decide which format applies — China's largest single entry is 1,843 bytes, of
 * which the format itself (`"(\\d{2})(\\d{5,6})"`, `"$1 $2"`) is 28. The rest enumerates
 * every area code the layout covers, once loosely so as-you-type can match a half-typed
 * number and once strictly. The plans with the messiest numbering are the expensive ones
 * — CN 3.96 KB, AR 3.02, IN 2.91, JP 2.80, GB 2.62 — and the mean is 0.33 KB.
 *
 * That shape is why subsetting pays so well and why it is sublinear in the useful
 * direction: 2 countries is 1.8 KB, 20 is 15.0, 40 is 27.1, 58 is 35.2. Most of the
 * saving is already had well before the list stops being reasonable.
 *
 * ## Every plan keeps its identity; only the named ones are *formatted*
 *
 * The obvious way to subset — keep 44 countries, drop 201 — is wrong, and measurably so.
 * Dropping a country drops its calling code with it, and then `+234 803 123 4567` does not
 * parse at all: `toE164` returns null for an internationally written Nigerian number,
 * which in this skin is an SMS thread that cannot be keyed and a chain left unbound. That
 * is the exact failure `phoneInput.ts` is written against, arriving by a new route.
 *
 * The *nearly*-right way is worse, because it fails quietly. Keeping every country but
 * trimming each unnamed one to the four fields E.164 obviously needs — calling code,
 * international prefix, national number pattern, possible lengths — parses `+234…`
 * correctly and turns a nationally written `08031234567` into **`+23408031234567`**: the
 * trunk `0` is not stripped, because the rule that strips it lives in the fields that were
 * cut. A number that canonicalises to something plausible and wrong is the one outcome
 * worse than one that returns null, and it cost 3.1 KB to avoid.
 *
 * So {@link trimMetadata} keeps every country, every calling code, and every field up to
 * {@link TRIMMED_LENGTH} — everything that decides *what number this is*. What it drops
 * from an unnamed plan is {@link FORMATS_FIELD}, the leading-digit regexes that are 60% of
 * the table, and the type patterns after it. Those answer how a number should be *grouped*
 * and whether it is a mobile, and nothing else.
 *
 * **Identity is never traded, only presentation.** A number from a trimmed plan resolves
 * to the same E.164 string it always did, typed nationally or internationally, and merely
 * comes out of the as-you-type formatter ungrouped. That is what makes the list below a
 * matter of taste rather than of correctness: shortening it makes some numbers display
 * plainer, and can never make two numbers one thread or one number two.
 *
 * 48.6 KB against the full table's 82.0 KB.
 *
 * So the list is a statement about **where this deployment's numbers are**, and it is
 * checkable rather than a matter of taste: `scripts/phone-countries.py` reads the
 * `phone_lines`, `call_events` and `sms_messages` tables and reports which plans actually
 * appear, naming any that this list does not cover. Run it against a populated database
 * before editing the list, and put its answer in the commit message.
 */

/**
 * The plans carried in full — formats, type patterns and all. 44 of 245; the other 201
 * are still recognised, per the note above.
 *
 * **Provenance: chosen, not yet measured.** `scripts/phone-countries.py` is the thing
 * that settles this, and it needs a populated database; the list below is where to start
 * from until it has been run — the regions the service is operated from and sold into,
 * plus the whole EU/EEA, on the grounds that a European deployment that dials one member
 * state dials several. Trim it with the script's answer rather than by opinion; each
 * entry costs about 0.33 KB and the four heaviest cost ten times that.
 */
export const FORMATTED_COUNTRIES: readonly string[] = [
  // Named as the service's own regions.
  'US', 'CA', 'GB', 'AU', 'PT',
  // The rest of the Anglosphere, which shares NANP or close numbering habits.
  'IE', 'NZ', 'ZA',
  // Western Europe.
  'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'CH', 'AT', 'LU',
  // The Nordics.
  'SE', 'NO', 'DK', 'FI', 'IS',
  // Central and Eastern EU.
  'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'EE', 'LV', 'LT',
  // Mediterranean EU.
  'GR', 'MT', 'CY',
  // Non-European markets a VoIP line is routinely dialled into.
  'JP', 'SG', 'HK', 'IN', 'AE', 'IL', 'MX', 'BR',
]

/** Where the generated table lands, relative to `frontend/`. */
export const METADATA_IN_FRONTEND = 'src/lib/phoneMetadata.json'

/** The full table, relative to `frontend/`. Read from the installed package, never vendored. */
export const FULL_METADATA_IN_FRONTEND = 'node_modules/libphonenumber-js/metadata.min.json'

/**
 * The shape this file moves around.
 *
 * Deliberately loose about a country's own entry: it is a positional array whose layout
 * belongs to `libphonenumber-js`, and restating it here would be a second copy to keep in
 * step with a package that is free to change it. Nothing in this module reads inside one.
 */
export interface PhoneMetadata {
  version: number | string
  /** Calling code to the countries that use it, most significant first. */
  country_calling_codes: Record<string, string[]>
  countries: Record<string, unknown>
  /** +800 and friends: not a country's, cheap (2.3 KB), and dropping it breaks real numbers. */
  nonGeographic: Record<string, unknown>
}

/**
 * Index of `formats` in a country's entry — the field a trimmed plan gives up.
 *
 * A country entry is a positional array belonging to `libphonenumber-js`. Fields 0–3 are
 * the calling code, international prefix, national number pattern and possible lengths;
 * 5–10 are the national-prefix rules, including the one that strips a trunk `0`. All of
 * those decide *what number this is*. Field 4 alone decides how it is grouped, and is 60%
 * of the table.
 */
export const FORMATS_FIELD = 4

/**
 * How many leading fields of a country's entry a trimmed plan keeps.
 *
 * Eleven, so that fields 5–10 survive: it is a 3.1 KB difference against stopping at 4,
 * and stopping at 4 turns a nationally written `08031234567` into `+23408031234567`
 * because the trunk-prefix rule was in the part that was cut. Everything from 11 on is
 * type patterns — is this a mobile, is it toll free — which nothing here asks.
 */
export const TRIMMED_LENGTH = 11

/**
 * The full table with every unnamed plan's formats emptied and its type patterns cut.
 *
 * Every calling code and every country survives — see the header for why dropping them is
 * the wrong subset — so this only ever changes how a number is *displayed*.
 *
 * The emptied field is an empty list rather than the `0` the package uses for its absent
 * optional fields. Both work today, because the accessor treats a missing formats list as
 * none; a list is what the field *is*, and the difference costs 201 bytes across the whole
 * table.
 *
 * `country_calling_codes` is carried through untouched, which keeps each code's countries
 * in the package's own order: the first is the one an ambiguous number is attributed to,
 * `1` is `['US', 'AG', 'AI', …]`, and reordering it would quietly make a NANP number
 * Antiguan. `version` likewise — `libphonenumber-js` refuses metadata whose version it
 * does not recognise, and that check is the only thing standing between a stale generated
 * file and silently wrong parsing.
 */
export function trimMetadata(full: PhoneMetadata, formatted: readonly string[]): PhoneMetadata {
  const countries: Record<string, unknown> = {}
  for (const [code, entry] of Object.entries(full.countries)) {
    if (formatted.includes(code)) {
      countries[code] = entry
      continue
    }
    const trimmed = (entry as unknown[]).slice(0, TRIMMED_LENGTH)
    if (trimmed.length > FORMATS_FIELD) trimmed[FORMATS_FIELD] = []
    countries[code] = trimmed
  }
  return {
    version: full.version,
    country_calling_codes: full.country_calling_codes,
    countries,
    nonGeographic: full.nonGeographic,
  }
}

/**
 * Countries named in {@link FORMATTED_COUNTRIES} that the installed package does not have.
 *
 * A typo would otherwise be silent — `trimMetadata` simply never matches it, so `'UK'`
 * (which is not a country code; the United Kingdom is `GB`) would trim a plan while
 * looking like it had kept one.
 */
export function unknownCountries(
  full: PhoneMetadata,
  countries: readonly string[],
): string[] {
  return countries.filter(code => !(code in full.countries))
}

/** The exact bytes the generated file holds: compact JSON, one trailing newline. */
export function renderMetadata(metadata: PhoneMetadata): string {
  return `${JSON.stringify(metadata)}\n`
}
