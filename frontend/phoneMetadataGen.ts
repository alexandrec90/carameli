/**
 * Writes `src/lib/phoneMetadata.json` from the installed `libphonenumber-js`.
 *
 * The filesystem half of ./phoneMetadata.ts, split the way ./comicAssetsWatch.ts is split
 * from ./comicAssets.ts and for the same reason: the subsetting is pure and tested
 * against objects built in the test, and this is the part that needs a disk.
 *
 * Run it with `npm run gen:phone-metadata`. You need to when the country list changes and
 * when `libphonenumber-js` is upgraded — and you will be told rather than having to
 * remember, because `phoneMetadata.test.ts` regenerates in memory and fails when the
 * committed file is not what this would write. That check is the point of committing a
 * generated file at all: a Dependabot bump that revises a numbering plan has to show up
 * as a reviewable diff of what visitors download, not as numbers that quietly stop
 * parsing three weeks later.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FORMATTED_COUNTRIES,
  FULL_METADATA_IN_FRONTEND,
  METADATA_IN_FRONTEND,
  renderMetadata,
  trimMetadata,
  unknownCountries,
} from './phoneMetadata.ts'
import type { PhoneMetadata } from './phoneMetadata.ts'

const FRONTEND = dirname(fileURLToPath(import.meta.url))

/** The installed package's full table. */
export function readFullMetadata(): PhoneMetadata {
  return JSON.parse(readFileSync(resolve(FRONTEND, FULL_METADATA_IN_FRONTEND), 'utf8'))
}

/** What the committed file holds today, or '' when it has never been written. */
export function readGeneratedMetadata(): string {
  try {
    return readFileSync(resolve(FRONTEND, METADATA_IN_FRONTEND), 'utf8')
  } catch {
    return ''
  }
}

/** The bytes the committed file should hold, given today's package and country list. */
export function expectedMetadata(): string {
  const full = readFullMetadata()
  const missing = unknownCountries(full, FORMATTED_COUNTRIES)
  if (missing.length > 0) {
    throw new Error(
      `FORMATTED_COUNTRIES names ${missing.join(', ')}, which libphonenumber-js does not ` +
        'have. A country code is ISO 3166-1 alpha-2 — the United Kingdom is GB, not UK.',
    )
  }
  return renderMetadata(trimMetadata(full, FORMATTED_COUNTRIES))
}

function main(): void {
  const text = expectedMetadata()
  writeFileSync(resolve(FRONTEND, METADATA_IN_FRONTEND), text, 'utf8')
  const full = readFileSync(resolve(FRONTEND, FULL_METADATA_IN_FRONTEND), 'utf8')
  const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`
  process.stdout.write(
    `${METADATA_IN_FRONTEND}: ${FORMATTED_COUNTRIES.length} plans formatted, ` +
      `${Object.keys(JSON.parse(full).countries).length} recognised, ` +
      `${kb(text.length)} of ${kb(full.length)}\n`,
  )
}

// The `if __name__ == '__main__'` of this file: everything above is importable by the
// test, and only a direct `node phoneMetadataGen.ts` writes anything. Compared as resolved
// paths rather than as URL text because the two spellings differ on Windows.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
