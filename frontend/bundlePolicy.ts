/**
 * What the *build* is allowed to weigh, expressed as data so a test can enforce it.
 *
 * The companion to {@link ./assetPolicy.ts}, and the division of labour between them is
 * the point. `assetPolicy` bounds `public/` — files Vite copies into `dist/` verbatim,
 * which it can check without building anything. This file bounds everything Vite
 * *produces*: the JavaScript chunks, the CSS, and the font files pulled in through
 * `@fontsource`. Neither one sees the other's half, and until now only the first half
 * had a number attached to it.
 *
 * Like `assetPolicy`, this module lives at the frontend root rather than under `src/`,
 * so `node:fs` stays out of the browser bundle.
 *
 * ## Why the eager set is the number that matters
 *
 * The app splits per skin and per route: `src/skins/registry.ts` loads each skin through
 * a dynamic `import()`, and the routes do the same. So most of what `dist/assets/` holds
 * is *conditional* — the 243 KB `sip.js` web chunk reaches only a visitor who opens the
 * softphone, and a skin's chunk reaches only visitors of that skin.
 *
 * That makes total build size a weak signal and the **eager set** — the scripts and
 * stylesheets `index.html` names directly, plus anything Vite decides to `modulepreload`
 * alongside them — a strong one. Every visitor downloads all of it before anything
 * renders, whatever skin or route they landed on. The failure this file exists to catch
 * is a static `import` where a dynamic one was intended: nothing looks different, no
 * test breaks, and a lazily-loaded 146 KB skin silently becomes part of what everybody
 * pays for. {@link MAX_EAGER_BYTES} is what notices, and
 * {@link skinChunksAreLazy the skin-laziness check} says which import did it.
 *
 * ## These are invariants, not benchmarks
 *
 * The same rule `assetPolicy` states applies here and is worth repeating, because the
 * temptation is stronger on this side: nothing in this file times anything. A build that
 * asserts a duration asserts the runner's afternoon. Bytes shipped are deterministic,
 * reviewable, and caused entirely by decisions in this repo — so they are the half a
 * test can own honestly. The other half is a browser's job, against a real preview.
 *
 * ## The numbers are ratchets
 *
 * Every cap is set just above what the build costs today, for the reason `assetPolicy`
 * gives at length: a budget's value is that it fails on the way *up*. Raising one is a
 * one-line diff that says what every visitor now downloads, which is exactly the shape
 * that decision should have in review.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { FRONTEND_ROOT } from './assetPolicy'

/** Vite's output directory. Absent until `npm run build` has run. */
export const DIST_DIR = path.join(FRONTEND_ROOT, 'dist')

/** Hashed build output. `public/` is copied to `dist/` root, so it never lands here. */
export const DIST_ASSETS_DIR = path.join(DIST_DIR, 'assets')

/** The built entry document. */
export const DIST_INDEX_HTML = path.join(DIST_DIR, 'index.html')

/**
 * Everything `index.html` loads before it can render: the entry script, the entry
 * stylesheet, and any `modulepreload` Vite emits for the entry's static import graph.
 *
 * Today that is two files totalling 274 KB — one JS chunk and one CSS file, with no
 * modulepreload at all, which is to say the entry's static graph is exactly itself.
 * A skin or a route becoming a static import is what moves this, and moving this is
 * what the whole file is for.
 */
export const MAX_EAGER_BYTES = 300 * 1024

/**
 * Ceiling for any single lazily-loaded chunk.
 *
 * Today's largest is `sip.js`'s web platform at 243 KB, reached only by opening the
 * softphone. A lazy chunk is allowed to be much larger than an eager one — that is the
 * whole trade the code splitting buys — but not unboundedly so: past a point the route
 * that owns it is slow enough to feel broken, and the honest fix is to split it again.
 */
export const MAX_LAZY_CHUNK_BYTES = 260 * 1024

/**
 * Every `.js` file in `dist/assets/`, summed. Today 941 KB across 45 chunks; the
 * regional phone formatter lives in the lazy comic-book skin rather than the eager
 * entry graph, and so do the projected surfaces (table and number pad) and the bubble
 * chains — none of them is downloaded by a visitor who never opens that skin, which is
 * why the eager-entry budget above did not move with them.
 *
 * The last raise (935 → 945) is a bubble chain bound to real SMS: the conversation hook,
 * its reconciliation lib and the wheel→number binding. Same trade as the line above —
 * `useSmsConversations` is reachable from every skin, but the code that *subscribes* to
 * it is in the comic-book chunk, and a visitor who never opens that skin never pays for
 * a request either.
 */
export const MAX_TOTAL_JS_BYTES = 945 * 1024

/** Every `.css` file in `dist/assets/`, summed. Today 38 KB across 2 files. */
export const MAX_TOTAL_CSS_BYTES = 44 * 1024

/**
 * Every webfont in `dist/assets/`, summed. Today 231 KB: five weights of Outfit, each
 * emitted twice by `@fontsource` as `.woff2` and a `.woff` fallback.
 *
 * Worth knowing when this fails: `src/main.tsx` imports the weights one line at a time,
 * so a sixth weight is a one-line change that costs about 46 KB, and dropping the
 * `.woff` fallbacks would reclaim 131 KB of the current total from browsers that have
 * not needed them in years.
 */
export const MAX_FONT_BYTES = 240 * 1024

/**
 * Extensions that must never appear in the build.
 *
 * `.map` is the one that matters: source maps are off by default in Vite and turning
 * them on publishes readable source for the whole app, so their absence is a security
 * property rather than a size one — worth failing on rather than noticing later.
 */
export const FORBIDDEN_DIST_EXTENSIONS: readonly string[] = ['.map']

/**
 * Floor on the number of JS chunks, so an empty or half-written `dist/` cannot pass
 * every budget above by having nothing in it. Today's build emits 45.
 */
export const MIN_EXPECTED_JS_CHUNKS = 20

/**
 * Length of the hash Vite appends to a chunk filename.
 *
 * Load-bearing rather than decorative: without a length, `comic` matches
 * `comic-book-LGd_JQZi.js`, because a hash may itself contain `-` (`Bumg7-mv`,
 * `4sp5-ZQW`) and so an open-ended character class swallows the rest of the name. That
 * is not hypothetical — it is what the first version of {@link findSkinChunk} did, and
 * a skin folded into the entry would have passed by matching a neighbour's chunk.
 *
 * It is Vite's default, not a guarantee, so {@link chunkHashLooksRight} asserts it
 * against the real build. A Vite change then fails there, saying the hash length moved,
 * rather than here as four skins mysteriously failing to split.
 */
export const CHUNK_HASH_LENGTH = 8

/** Extensions counted as webfonts. */
export const FONT_EXTENSIONS: readonly string[] = ['.woff', '.woff2', '.ttf', '.otf', '.eot']

/** A file emitted into `dist/assets/`. */
export interface BuiltAsset {
  /** Filename, hash and all: `index-DfkhGmi3.js`. */
  readonly name: string
  /** The URL `index.html` would reference it by: `/assets/index-DfkhGmi3.js`. */
  readonly url: string
  readonly ext: string
  readonly bytes: number
}

/** True once `npm run build` has produced something to measure. */
export function distExists(): boolean {
  return existsSync(DIST_INDEX_HTML) && existsSync(DIST_ASSETS_DIR)
}

/**
 * The message a missing `dist/` fails with.
 *
 * Deliberately not a skip. A budget suite that quietly passes when there is nothing to
 * measure reports green having checked nothing, which is the failure mode the whole
 * asset-policy exercise was written to stop. `npm run test:bundle` builds first; running
 * the file any other way is what lands here, and it says so.
 */
export const NO_DIST_MESSAGE =
  `No build at ${DIST_DIR}. These budgets measure build output, so there is nothing ` +
  'to check until one exists — run `npm run test:bundle`, which builds first, rather ' +
  'than pointing vitest at this file directly.'

/** Every file in `dist/assets/`, flat — Vite does not nest inside it. */
export function listBuiltAssets(): BuiltAsset[] {
  return readdirSync(DIST_ASSETS_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => ({
      name: entry.name,
      url: `/assets/${entry.name}`,
      ext: path.extname(entry.name).toLowerCase(),
      bytes: statSync(path.join(DIST_ASSETS_DIR, entry.name)).size,
    }))
    .sort((a, b) => b.bytes - a.bytes)
}

/**
 * Build-output URLs referenced by `index.html` itself.
 *
 * Three tag shapes reach the browser before render and no others do: the entry
 * `<script type="module" src>`, the entry `<link rel="stylesheet" href>`, and every
 * `<link rel="modulepreload" href>` Vite emits for the entry's static imports. Matching
 * on the `/assets/` prefix rather than on tag names keeps this indifferent to attribute
 * order and to which of the three a given URL arrived in — a `preload`ed font in
 * `public/` is not under `/assets/`, so it belongs to `assetPolicy` and is not counted
 * twice here.
 */
export function findEagerAssetUrls(html: string): string[] {
  const urls = new Set<string>()
  for (const match of html.matchAll(/(?:src|href)\s*=\s*"(\/assets\/[^"]+)"/g)) {
    urls.add(match[1])
  }
  return [...urls].sort()
}

/** {@link findEagerAssetUrls} against the real built `index.html`. */
export function readEagerAssetUrls(): string[] {
  return findEagerAssetUrls(readFileSync(DIST_INDEX_HTML, 'utf-8'))
}

/**
 * The chunk a skin was split into, found by name.
 *
 * Vite names a dynamic-import chunk after its module directory, so
 * `import('./skins/comic-book')` becomes `comic-book-<hash>.js`. That naming is the only
 * link between {@link ../src/skins/registry.ts SKIN_NAMES} and the build output, so a
 * skin whose chunk cannot be found here is reported as missing rather than passed over:
 * a skin that failed to split has no chunk of its own precisely *because* its code was
 * folded into the eager entry, which is the regression being looked for.
 */
export function findSkinChunk(assets: readonly BuiltAsset[], skin: string): BuiltAsset | undefined {
  const literal = skin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${literal}-[A-Za-z0-9_-]{${CHUNK_HASH_LENGTH}}\\.js$`)
  return assets.find(asset => pattern.test(asset.name))
}

/**
 * Whether a built filename ends in a hash of the length {@link findSkinChunk} assumes.
 *
 * Checked against the real build so that a Vite change to `[hash]` is reported as what
 * it is, rather than as every skin appearing to have stopped splitting.
 */
export function chunkHashLooksRight(name: string): boolean {
  return new RegExp(`-[A-Za-z0-9_-]{${CHUNK_HASH_LENGTH}}\\.[a-z0-9]+$`).test(name)
}

/**
 * Skins whose chunk is missing, or is loaded eagerly by `index.html`.
 *
 * Both outcomes mean the same thing — the skin is no longer behind its dynamic import —
 * and they are reported apart only because the fix reads differently: a missing chunk is
 * a skin that never split, an eager one is a skin that split and was then also imported
 * statically from somewhere on the entry path.
 */
export function skinChunksAreLazy(
  assets: readonly BuiltAsset[],
  skins: readonly string[],
  eagerUrls: readonly string[],
): { missing: string[]; eager: string[] } {
  const eager = new Set(eagerUrls)
  const result = { missing: [] as string[], eager: [] as string[] }
  for (const skin of skins) {
    const chunk = findSkinChunk(assets, skin)
    if (!chunk) result.missing.push(skin)
    else if (eager.has(chunk.url)) result.eager.push(`${skin} (${chunk.name})`)
  }
  return result
}

/** True when `ext` is one of {@link FONT_EXTENSIONS}. */
export function isFont(ext: string): boolean {
  return FONT_EXTENSIONS.includes(ext)
}

/** Sum of `bytes` over the assets matching `predicate`. */
export function totalBytes(
  assets: readonly BuiltAsset[],
  predicate: (asset: BuiltAsset) => boolean,
): number {
  return assets.reduce((sum, asset) => (predicate(asset) ? sum + asset.bytes : sum), 0)
}
