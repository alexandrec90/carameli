/**
 * Enforcement for {@link ./phoneMetadata.ts} — the trimming as arithmetic, and the
 * committed table checked against what the installed package would produce now.
 *
 * Split the way {@link ./comicAssets.test.ts} is: the first half tests the transform
 * against a table built here, so a failure in the second half is about the package or the
 * committed file rather than about the transform.
 *
 * The second half is the one with teeth. A generated file that nobody regenerates is a
 * stale numbering plan shipped to visitors — and stale here does not announce itself, it
 * shows up months later as one country's numbers quietly failing to parse. So the check
 * is not "does the file exist" but "is it byte-for-byte what `npm run gen:phone-metadata`
 * would write today", which a `libphonenumber-js` bump fails on the Dependabot PR that
 * raises it.
 *
 * What *numbers* do under the trimmed table is `src/tests/skins/phoneInput.test.ts`, which
 * is where the property that matters — identity survives, presentation is what is traded
 * — is asserted against real numbers rather than against this file's arithmetic.
 */

import { describe, expect, it } from 'vitest'

import {
  FORMATS_FIELD,
  FORMATTED_COUNTRIES,
  METADATA_IN_FRONTEND,
  TRIMMED_LENGTH,
  renderMetadata,
  trimMetadata,
  unknownCountries,
} from './phoneMetadata.ts'
import type { PhoneMetadata } from './phoneMetadata.ts'
import { expectedMetadata, readFullMetadata, readGeneratedMetadata } from './phoneMetadataGen.ts'

/**
 * An entry long enough to tell a trimmed one from a whole one: fields 0-3 are identity,
 * 4 is the formats a trim empties, 5-10 are the prefix rules a trim must keep, and the
 * `['types']` at 11 is what a trim cuts.
 */
const entry = (callingCode: string) =>
  [callingCode, '00', '\\d{9}', [9], ['formats'], '0', 'rule', 0, 0, 0, 0, ['types']]

/** A table with enough shape to exercise every rule, and nothing else. */
const table: PhoneMetadata = {
  version: 4,
  country_calling_codes: { '1': ['US', 'CA', 'AG'], '44': ['GB', 'JE'], '55': ['BR'] },
  countries: {
    US: entry('1'), CA: entry('1'), AG: entry('1'),
    GB: entry('44'), JE: entry('44'), BR: entry('55'),
  },
  nonGeographic: { '800': ['800'] },
}

describe('trimMetadata', () => {
  it('keeps a named plan whole', () => {
    expect(trimMetadata(table, ['US']).countries.US).toEqual(table.countries.US)
  })

  it('empties an unnamed plan\'s formats and cuts its type patterns', () => {
    expect(trimMetadata(table, ['US']).countries.BR)
      .toEqual(['55', '00', '\\d{9}', [9], [], '0', 'rule', 0, 0, 0, 0])
  })

  // The bug this shape exists for. Stopping at field 4 costs 3.1 KB less and drops the
  // national-prefix rules with it, which turns a nationally written `08031234567` into
  // `+23408031234567` — plausible, wrong, and silent. The fields are cheap; identity isn't.
  it('keeps the national-prefix rules that decide what a number is', () => {
    const trimmed = trimMetadata(table, []).countries.BR as unknown[]
    expect(trimmed).toHaveLength(TRIMMED_LENGTH)
    expect(trimmed.slice(5)).toEqual(['0', 'rule', 0, 0, 0, 0])
  })

  it('leaves the emptied formats a list, which is what the field is', () => {
    expect((trimMetadata(table, []).countries.BR as unknown[])[FORMATS_FIELD]).toEqual([])
  })

  // The whole correction this file exists for. Dropping a country drops its calling code,
  // and then an internationally written number from it does not parse at all — which in
  // this skin is an SMS thread that cannot be keyed. Presentation is the only thing traded.
  it('keeps every country, so no calling code is ever lost', () => {
    const out = trimMetadata(table, ['US'])
    expect(Object.keys(out.countries).sort()).toEqual(Object.keys(table.countries).sort())
    expect(out.country_calling_codes).toEqual(table.country_calling_codes)
  })

  it('leaves a calling code\'s countries in the package\'s order, not the list\'s', () => {
    // The first is the one an ambiguous number is attributed to: reordering `1` would
    // quietly make a NANP number Antiguan.
    expect(trimMetadata(table, ['CA', 'US']).country_calling_codes['1']).toEqual(['US', 'CA', 'AG'])
  })

  it('carries the version through, which is what the parser checks', () => {
    expect(trimMetadata(table, ['US']).version).toBe(4)
  })

  it('keeps nonGeographic whole — it is +800 and friends, and belongs to no country', () => {
    expect(trimMetadata(table, ['US']).nonGeographic).toEqual(table.nonGeographic)
  })

  it('trims everything when nothing is named, and nothing when all are', () => {
    const none = trimMetadata(table, [])
    expect(Object.values(none.countries).every(e => (e as unknown[]).length === TRIMMED_LENGTH))
      .toBe(true)
    expect(trimMetadata(table, Object.keys(table.countries)).countries).toEqual(table.countries)
  })

  it('leaves an entry already shorter than the trim alone', () => {
    // Real ones exist: 44 of the package's plans have no formats and simply stop at four
    // fields. Slicing past the end must not invent a formats list for them.
    const short = { ...table, countries: { AC: ['247', '00', '\\d{5}', [5]] } }
    expect(trimMetadata(short, []).countries.AC).toEqual(['247', '00', '\\d{5}', [5]])
  })

  it('ignores a name the package does not have, which unknownCountries is for', () => {
    expect((trimMetadata(table, ['US', 'ZZ']).countries.US as unknown[])).toHaveLength(12)
    expect(unknownCountries(table, ['US', 'ZZ'])).toEqual(['ZZ'])
  })
})

describe('renderMetadata', () => {
  it('is compact JSON with one trailing newline', () => {
    const text = renderMetadata(trimMetadata(table, ['US']))
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).not.toContain('\n  ')
    expect(JSON.parse(text).countries.US).toEqual(table.countries.US)
  })
})

describe('FORMATTED_COUNTRIES', () => {
  const full = readFullMetadata()

  it('names only plans the installed package has', () => {
    expect(
      unknownCountries(full, FORMATTED_COUNTRIES),
      'A country code here is ISO 3166-1 alpha-2 and the package must know it. The ' +
        'United Kingdom is GB, not UK; a name it does not know is silently ignored, ' +
        'which looks like keeping a plan whole and is trimming it.',
    ).toEqual([])
  })

  it('has no duplicates, which would read as two plans and cost one', () => {
    expect(new Set(FORMATTED_COUNTRIES).size).toBe(FORMATTED_COUNTRIES.length)
  })

  it('carries the regions the service is operated from', () => {
    // Not a style assertion: these are the plans named in the decision to trim at all, so
    // losing one is losing the case for the smaller table rather than shortening it.
    for (const code of ['US', 'CA', 'GB', 'AU', 'PT']) expect(FORMATTED_COUNTRIES).toContain(code)
  })

  it('is a trim worth having, and still recognises every plan', () => {
    const ours = JSON.parse(expectedMetadata()) as PhoneMetadata
    expect(expectedMetadata().length).toBeLessThan(renderMetadata(full).length * 0.7)
    expect(Object.keys(ours.countries)).toHaveLength(Object.keys(full.countries).length)
    expect(Object.keys(ours.country_calling_codes))
      .toHaveLength(Object.keys(full.country_calling_codes).length)
  })
})

describe(METADATA_IN_FRONTEND, () => {
  it('is what the generator would write today', () => {
    expect(
      readGeneratedMetadata(),
      `${METADATA_IN_FRONTEND} is not what \`npm run gen:phone-metadata\` produces from ` +
        'the installed libphonenumber-js. Either FORMATTED_COUNTRIES changed without the ' +
        'file being regenerated, the package was upgraded and revised a numbering plan, ' +
        'or the file was hand-edited. Run the generator and review the diff — it is a ' +
        'diff of what visitors download, and of which numbers still parse.',
    ).toBe(expectedMetadata())
  })
})
