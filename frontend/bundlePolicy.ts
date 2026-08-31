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
 * Every `.js` file in `dist/assets/`, summed. Today 956.6 KB across 46 chunks; the
 * regional phone formatter lives in the lazy comic-book skin rather than the eager
 * entry graph, and so do the projected surfaces (table and number pad) and the bubble
 * chains — none of them is downloaded by a visitor who never opens that skin, which is
 * why the eager-entry budget above did not move with them.
 *
 * The last raise (950 → 955) is the `dial` bubble kind — the picker component, its pure
 * module, and the caret-preserving edit path lifted out of BubbleInput so both share
 * one. Same trade as the line above: the regional formatter it leans on was already in
 * the comic-book chunk for `phone`, and a visitor who never opens that skin pays for
 * none of it.
 *
 * The raise before (955 → 958) is 1.6 KB: the dial's keyboard grab on panel reveal and
 * its lettered caret — `dialCaret.ts`'s pure measurement math, the `useDialCaret` DOM
 * hook that positions the ink block per keystroke, and the fresh-number flag both
 * keyboards read. All of it lands in the same lazy comic-book chunk; `package.json` is
 * untouched and the chunk count is unchanged at 46, so nothing new was pulled in.
 *
 * The raise before that (958 → 964) is 5.7 KB: making a panel from the editor.
 * `panelGridCut.ts` cuts a ring in two along a straight line, `configPanels.ts` grows the
 * panel list, the pattern per panel and every grid together, and the panel list itself
 * moved into the editor-owned `layoutConfig.ts` so it is serialized and hydrated with the
 * rest. Same lazy comic-book chunk, same 46 chunks, `package.json` untouched.
 *
 * The raise before this one (964 → 965) is the SMS composer, 0.8 KB measured on its own
 * branch against the 958 that preceded both: its shared caret and keyboard handoff, its
 * per-column links and fixed recipient stem, plus reporting a texted number back to the
 * panel and the guard that stops an unbound chain answering its own composer. The two
 * raises were authored in parallel and neither subsumes the other, so the merge pays for
 * both — 964 was measured without this branch in the build. Same lazy chunk, still 46 of
 * them, `package.json` untouched, so nothing new was pulled in by either half.
 *
 * This raise (965 → 966) is handing a chain balloon's hover off at the seam, 1.26 KB
 * measured as this branch's merge (965.7 KB) against the master it merges (964.4 KB):
 * `panelHover.ts` hit-tests a balloon by its drawn outline rather than its box, and
 * `usePanelHover.ts` grew the SVG geometry probe that asks the shape, plus the tube
 * corridors `BubbleTubes` now labels with the panel they belong to. Same lazy comic-book
 * chunk, still 46 of them, `package.json` untouched, so nothing new was pulled in.
 *
 * This raise (966 → 970) is the call scene, 3.9 KB measured as this branch's build
 * (969.6 KB) against the master it branches from (965.7 KB): `PanelCallScene` splits the
 * handset's panel in two while a call is up, `callSceneGeometry.ts` cuts its polygon
 * along a vertical line a gutter apart, and `CallBubble` is a balloon holding a scrolling
 * transcript and the red key. The dev-only call simulation (`useCallSimulation`,
 * `callSimulation.ts`) is behind an `import.meta.env.DEV` test in App.tsx and is not in
 * the build — its script text does not appear in `dist/`. Same lazy comic-book chunk,
 * still 46 of them, `package.json` untouched, so nothing new was pulled in.
 *
 * This raise (970 → 971) is the scrollable call-records table, 0.48 KB measured as this
 * branch's merge (970.2 KB) against the master it merges (969.7 KB): `liveTables.ts`
 * fetches a hundred records and maps each call's status to its own piece of art, and
 * `ProjectedTable` scrolls that body inside the panel's fixed band while the headings
 * stay put. Same lazy comic-book chunk, still 46 of them, `package.json` untouched, so
 * nothing new was pulled in.
 *
 * This raise (971 → 972) was not any one branch's — nothing in it ships JavaScript.
 * Master went 0.2 KB over on 2026-08-29, when three comic-book PRs merged within minutes
 * of each other, each measured against a master that did not yet contain the other two.
 * The default branch runs no gate of its own, so the overflow was invisible there and
 * surfaced on the first PR to merge that master in. Still 46 chunks and `package.json`
 * untouched: three already accepted costs arriving together.
 *
 * Parallel branches are how this budget gets passed rather than raised, which is why the
 * paragraphs here each say which master their number was measured against — and why this
 * merge pays for both halves rather than one subsuming the other.
 *
 * This raise (972 → 973) is `+ SMS` making a conversation whole, 0.79 KB measured as this
 * branch's build (971.1 KB) against the master it branches from (970.3 KB):
 * `chainCreate.ts` spawns both root bubbles already linked, chained and bound, and
 * `reconcile.ts` is the settle step lifted out of `configOps.ts` so it can. The dashed
 * frame that made the change visible — `chainFrame.ts` and the overlay that draws it — is
 * *not* in this number: `EditorOverlay` is behind an `import.meta.env.DEV` test in
 * Layout.tsx and never reaches the build. What does reach it is the editor's state layer,
 * which Layout imports statically for `useEditorMode`, and that is where these 0.79 KB
 * land. Same lazy comic-book chunk, still 46 of them, `package.json` untouched, so nothing
 * new was pulled in.
 *
 * This raise (973 → 981) is the call layout becoming editable, 6.8 KB measured as this
 * branch's build (979.6 KB) against the master it now contains (972.8 KB) — re-measured
 * after that merge because master had moved 0.9 KB under it in the meantime and a
 * paragraph naming a master that is no longer there cannot be checked. The extra
 * kilobyte over the measurement is deliberate for the reason the 971 → 972 paragraph
 * gives: the default branch runs no gate, so a ceiling set flush against one branch's
 * build is passed by the next two that merge in parallel.
 *
 * 4.97 KB of it is the feature and 1.8 KB is the shape the structural ratchet asked for:
 * `BubbleBody.tsx`, `BubbleSlot.tsx`, `PanelFlatBubble.tsx` and `PanelChainThread.tsx`
 * are PanelBubble/PanelBubbles split along the branches that had grown past the
 * complexity limit, and `useCallEdits.ts`/`useGridEdits.ts` are the same for
 * `useEditorMode`. Nothing was added: the cost is prop declarations and the call sites
 * that pass them, which is what extracting a closure into a component costs. It is not a
 * scene widget any more: `callSceneRoles.ts` answers every question a `call` role is
 * asked — which half, which moment, which voice — and `PanelImages`/`PanelBubbles` place
 * an entry against that half, so the call is drawn out of the same pictures and balloons
 * as everything else. The editor's own half is `callSceneOps.ts` (the derived scene list)
 * and `callSceneCreate.ts` (the one op that builds a whole call), which reach the build
 * through `useEditorMode`, imported statically by Layout.tsx. `EditorOverlay` and
 * `InspectorPanel` do not — they are behind an `import.meta.env.DEV` test — so the seam
 * range, the role select and the half-aware click targets are not in this number.
 * `CallBubble.tsx` came out in the same change and is subtracted from it. Same lazy
 * comic-book chunk, still 46 of them, `package.json` untouched, so nothing new was
 * pulled in.
 */
export const MAX_TOTAL_JS_BYTES = 981 * 1024

/**
 * Every `.css` file in `dist/assets/`, summed. Today 44.2 KB across 2 files.
 *
 * This raise (44 → 45) is the chain's typing-dots row — the bounce, its stagger, and the
 * reduced-motion pulse that replaces it. The build was already within 0.3 KB of the
 * ceiling before those rules, so most of the headroom this buys is theirs only on paper.
 *
 * This raise (45 → 46) is the chain's connector tubes: the SVG layer they are drawn on,
 * the `d` transition that makes a tube follow its balloons as the conversation scrolls,
 * and the reduced-motion rule that switches that off. About 0.2 KB, against a build that
 * had 0.1 KB of room — the same story as the raise above, one line further along. What
 * this does *not* pay for is the lettered caret, which arrived twice: once on this branch
 * as a field's caret shared by the dial and the SMS composer, once on master as the
 * dial's own. Deduplicating it in the merge is what kept this raise to a single KB.
 *
 * This raise (46 → 47) is the call scene's sheet (`callScene.css`): the two halves and
 * their pictures, the paper gutter between them, the ink around each, and the transcript
 * balloon with its scrolling window and the key under it. About 0.3 KB, against a build
 * that had 0.05 KB of room.
 *
 * This raise (47 → 48) is the number pad's glow (`number-pad.css`): the two keyframe
 * sets the lit and the pressed states now animate through, and the reduced-motion block
 * that holds each level instead of breathing it. About 0.45 KB, against a build that had
 * none. Outside the editor the pad paints its glyphs in `transparent`, so this light is
 * the only thing that says a key is under the pointer, and the static tint it replaces
 * read as a button that had always been there rather than as light thrown onto a
 * photographed surface.
 */
export const MAX_TOTAL_CSS_BYTES = 48 * 1024

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
 * every budget above by having nothing in it. Today's build emits 46.
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
