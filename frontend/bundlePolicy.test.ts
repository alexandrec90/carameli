/**
 * Enforcement for {@link ./bundlePolicy.ts} — the build, checked against itself.
 *
 * Split the same way {@link ./assetPolicy.test.ts} is, for the same reason. The first
 * half tests the HTML scanning and the chunk matching as pure functions against strings
 * built here; the second half points them at a real `dist/` and asserts the budgets. If
 * the second half fails, the first half is what tells you the finding is about the build
 * rather than about a regex.
 *
 * **This file needs a build, and it fails rather than skips without one.** It is
 * excluded from the default `vitest` run in `vite.config.ts` and reached through
 * `npm run test:bundle`, which builds first. That indirection is the price of the rule
 * in `.claude/rules/engineering.md`: a suite that skips itself when its input is missing
 * reports green having checked nothing, and would have gone on doing so for however long
 * it took someone to notice `dist/` was never being written in CI.
 */

import { describe, expect, it } from 'vitest'

import { SKIN_NAMES } from './src/skins/registry'
import {
  CHUNK_HASH_LENGTH,
  DIST_ASSETS_DIR,
  FORBIDDEN_DIST_EXTENSIONS,
  MAX_EAGER_BYTES,
  MAX_FONT_BYTES,
  MAX_LAZY_CHUNK_BYTES,
  MAX_TOTAL_CSS_BYTES,
  MAX_TOTAL_JS_BYTES,
  MIN_EXPECTED_JS_CHUNKS,
  NO_DIST_MESSAGE,
  chunkHashLooksRight,
  distExists,
  findEagerAssetUrls,
  findSkinChunk,
  isFont,
  listBuiltAssets,
  readEagerAssetUrls,
  skinChunksAreLazy,
  totalBytes,
} from './bundlePolicy'
import type { BuiltAsset } from './bundlePolicy'

const KB = 1024

const kb = (bytes: number): string => `${(bytes / KB).toFixed(1)} KB`

/** A synthetic asset, so the pure helpers are tested against known sizes. */
const asset = (name: string, bytes: number): BuiltAsset => ({
  name,
  url: `/assets/${name}`,
  ext: name.slice(name.lastIndexOf('.')),
  bytes,
})

describe('findEagerAssetUrls', () => {
  it('finds the entry script and stylesheet', () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
      </head><body><script type="module" crossorigin src="/assets/index-def.js"></script>
      </body></html>`
    expect(findEagerAssetUrls(html)).toEqual(['/assets/index-abc.css', '/assets/index-def.js'])
  })

  it('finds modulepreload links, which is how a static import shows up', () => {
    const html = `<link rel="modulepreload" crossorigin href="/assets/candy-shop-abc.js">
      <script type="module" src="/assets/index-def.js"></script>`
    expect(findEagerAssetUrls(html)).toContain('/assets/candy-shop-abc.js')
  })

  it('is indifferent to attribute order', () => {
    const html = `<script src="/assets/a.js" type="module"></script>
      <script type="module" src="/assets/b.js"></script>`
    expect(findEagerAssetUrls(html)).toEqual(['/assets/a.js', '/assets/b.js'])
  })

  it('ignores references outside /assets/, which belong to assetPolicy', () => {
    const html = `<link rel="preload" as="image" href="/comic-book/switchboard.webp">
      <link rel="icon" href="/favicon.ico">
      <script type="module" src="/assets/index-def.js"></script>`
    expect(findEagerAssetUrls(html)).toEqual(['/assets/index-def.js'])
  })

  it('counts a URL named twice once', () => {
    const html = `<link rel="modulepreload" href="/assets/a.js">
      <script type="module" src="/assets/a.js"></script>`
    expect(findEagerAssetUrls(html)).toEqual(['/assets/a.js'])
  })
})

describe('findSkinChunk', () => {
  const assets = [
    asset('comic-book-LGd_JQZi.js', 41_000),
    asset('candy-shop-DbBvELI5.js', 145_000),
    asset('index-DfkhGmi3.js', 242_000),
  ]

  it('matches a hyphenated skin name against its hashed chunk', () => {
    expect(findSkinChunk(assets, 'comic-book')?.name).toBe('comic-book-LGd_JQZi.js')
  })

  it('does not match a skin name that is only a prefix of another chunk', () => {
    // `comic` against `comic-book-LGd_JQZi.js`. An open-ended hash class matches here,
    // because a real hash may contain `-`, and a skin folded into the entry would then
    // pass by finding a neighbour's chunk. This is why the length is pinned.
    expect(findSkinChunk(assets, 'comic')).toBeUndefined()
  })

  it('does not match a CSS file of the same name', () => {
    expect(findSkinChunk([asset('comic-book-CeeNsd1v.css', 7_000)], 'comic-book')).toBeUndefined()
  })

  it('matches a hash containing a hyphen, which Vite does emit', () => {
    expect(findSkinChunk([asset('barebone-4sp5-ZQW.js', 10)], 'barebone')?.name).toBe(
      'barebone-4sp5-ZQW.js',
    )
  })

  it('treats regex metacharacters in a skin name literally', () => {
    expect(findSkinChunk([asset('a.b-12345678.js', 10)], 'a.b')?.name).toBe('a.b-12345678.js')
    expect(findSkinChunk([asset('axb-12345678.js', 10)], 'a.b')).toBeUndefined()
  })
})

describe('chunkHashLooksRight', () => {
  it('accepts the hashes this build emits', () => {
    expect(['index-DfkhGmi3.js', 'barebone-4sp5-ZQW.js', 'comic-book-CeeNsd1v.css'].every(
      chunkHashLooksRight,
    )).toBe(true)
  })

  it('rejects a hash of another length, which is what a Vite change would look like', () => {
    expect(chunkHashLooksRight('index-DfkhGmi3ab.js')).toBe(false)
    expect(chunkHashLooksRight('index.js')).toBe(false)
  })
})

describe('skinChunksAreLazy', () => {
  const assets = [asset('comic-book-LGd_JQZi.js', 41_000), asset('candy-shop-DbBvELI5.js', 145_000)]

  it('passes when every skin has a chunk index.html does not name', () => {
    const skins = ['comic-book', 'candy-shop']
    expect(skinChunksAreLazy(assets, skins, ['/assets/index-DfkhGmi3.js'])).toEqual({
      missing: [],
      eager: [],
    })
  })

  it('reports a skin folded into the entry as missing', () => {
    expect(skinChunksAreLazy(assets, ['barebone'], []).missing).toEqual(['barebone'])
  })

  it('reports a skin that split but is also preloaded', () => {
    const result = skinChunksAreLazy(assets, ['candy-shop'], ['/assets/candy-shop-DbBvELI5.js'])
    expect(result.eager).toEqual(['candy-shop (candy-shop-DbBvELI5.js)'])
  })
})

describe('totalBytes and isFont', () => {
  it('sums only what the predicate selects', () => {
    const assets = [asset('a.js', 100), asset('b.css', 20), asset('c.js', 3)]
    expect(totalBytes(assets, a => a.ext === '.js')).toBe(103)
  })

  it('sums an empty selection to zero rather than throwing', () => {
    expect(totalBytes([], () => true)).toBe(0)
  })

  it('recognises the font extensions @fontsource emits', () => {
    expect(['.woff', '.woff2'].every(isFont)).toBe(true)
    expect(isFont('.js')).toBe(false)
  })
})

describe('the build', () => {
  it('exists, so no budget below can pass by measuring nothing', () => {
    expect(distExists(), NO_DIST_MESSAGE).toBe(true)
  })

  const assets = distExists() ? listBuiltAssets() : []
  const eagerUrls = distExists() ? readEagerAssetUrls() : []
  const scripts = assets.filter(a => a.ext === '.js')

  it('emitted a plausible number of chunks', () => {
    expect(
      scripts.length,
      `Only ${scripts.length} JS chunks in ${DIST_ASSETS_DIR}. Either the build was ` +
        'interrupted, or the route and skin splitting collapsed — both make every ' +
        'budget below meaningless, so this is asserted rather than assumed.',
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_JS_CHUNKS)
  })

  it('hashes its chunks the way the skin lookup assumes', () => {
    const odd = scripts.filter(a => !chunkHashLooksRight(a.name)).map(a => a.name)
    expect(
      odd,
      `These chunks do not end in a ${CHUNK_HASH_LENGTH}-character hash, which is what ` +
        '`findSkinChunk` matches on. Vite changing `[hash]` is the likely cause — fix ' +
        'CHUNK_HASH_LENGTH here rather than downstream, where it surfaces as every skin ' +
        'appearing to have stopped splitting.',
    ).toEqual([])
  })

  it('ships no source maps or other forbidden output', () => {
    const forbidden = assets
      .filter(a => FORBIDDEN_DIST_EXTENSIONS.includes(a.ext))
      .map(a => a.name)
    expect(
      forbidden,
      'The build emitted files it must not. A `.map` publishes readable source for ' +
        'the whole app to anyone who opens devtools, so its absence is a security ' +
        'property, not a size one — turn `build.sourcemap` back off rather than ' +
        'widening this list.',
    ).toEqual([])
  })

  it('keeps the eager set — what every visitor downloads — within budget', () => {
    expect(
      eagerUrls.length,
      'index.html references no build output at all, so the eager budget below would ' +
        'pass on an empty set.',
    ).toBeGreaterThan(0)

    const byUrl = new Map(assets.map(a => [a.url, a]))
    const missing = eagerUrls.filter(url => !byUrl.has(url))
    expect(missing, 'index.html references build output that is not in dist/assets/').toEqual([])

    const total = eagerUrls.reduce((sum, url) => sum + (byUrl.get(url)?.bytes ?? 0), 0)
    expect(
      total,
      `The ${eagerUrls.length} eagerly-loaded assets total ${kb(total)}, over the ` +
        `${kb(MAX_EAGER_BYTES)} budget. Every visitor downloads all of this before ` +
        'anything renders, whatever skin or route they arrived on. The usual cause is ' +
        'a static `import` where a dynamic one was meant: check what joined the list ' +
        `— it is currently [${eagerUrls.join(', ')}].`,
    ).toBeLessThanOrEqual(MAX_EAGER_BYTES)
  })

  it('keeps every skin behind its dynamic import', () => {
    const { missing, eager } = skinChunksAreLazy(assets, SKIN_NAMES, eagerUrls)
    expect(
      missing,
      'These skins have no chunk of their own, which means their code was folded into ' +
        'the entry instead of split out. `src/skins/registry.ts` loads each skin ' +
        'through `import()` precisely so it does not ship to visitors of the others.',
    ).toEqual([])
    expect(
      eager,
      'These skins split correctly and are then loaded eagerly anyway, so the split ' +
        'buys nothing — something on the entry path imports them statically as well.',
    ).toEqual([])
  })

  it('keeps every lazy chunk under the per-chunk ceiling', () => {
    const eager = new Set(eagerUrls)
    const oversized = scripts
      .filter(a => !eager.has(a.url) && a.bytes > MAX_LAZY_CHUNK_BYTES)
      .map(a => `${a.name}: ${kb(a.bytes)}`)
    expect(
      oversized,
      `Over the ${kb(MAX_LAZY_CHUNK_BYTES)} per-chunk ceiling. A lazy chunk may be far ` +
        'larger than an eager one — that is the trade code splitting buys — but past a ' +
        'point the route that owns it feels broken, and the fix is another split rather ' +
        'than a bigger number here.',
    ).toEqual([])
  })

  it('keeps total JavaScript within budget', () => {
    const total = totalBytes(assets, a => a.ext === '.js')
    expect(
      total,
      `dist/assets/ holds ${kb(total)} of JavaScript across ${scripts.length} chunks, ` +
        `over the ${kb(MAX_TOTAL_JS_BYTES)} budget. No single visitor downloads all of ` +
        'it, so this is the weaker of the two size signals — but a jump here with the ' +
        'eager set unchanged is a new dependency arriving somewhere.',
    ).toBeLessThanOrEqual(MAX_TOTAL_JS_BYTES)
  })

  it('keeps total CSS within budget', () => {
    const total = totalBytes(assets, a => a.ext === '.css')
    expect(
      total,
      `dist/assets/ holds ${kb(total)} of CSS, over the ${kb(MAX_TOTAL_CSS_BYTES)} ` +
        'budget. Tailwind is scanned per build, so this grows with the classes actually ' +
        'used rather than with the framework.',
    ).toBeLessThanOrEqual(MAX_TOTAL_CSS_BYTES)
  })

  it('keeps webfonts within budget', () => {
    const total = totalBytes(assets, a => isFont(a.ext))
    expect(
      total,
      `dist/assets/ holds ${kb(total)} of webfonts, over the ${kb(MAX_FONT_BYTES)} ` +
        'budget. `src/main.tsx` imports Outfit one weight at a time and @fontsource ' +
        'emits each twice (.woff2 plus a .woff fallback), so a single added import line ' +
        'costs roughly 46 KB here.',
    ).toBeLessThanOrEqual(MAX_FONT_BYTES)
  })
})
