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
 * Today that is three files totalling 311.2 KB: the entry JS chunk, the entry CSS, and
 * one `modulepreload` for `logger`, which `src/lib/logger.ts` earns by being imported
 * on the entry path. A skin or a route becoming a static import is what moves this, and
 * moving this is what the whole file is for.
 *
 * This raise (300 → 316) is not a change in this repository: it is React 19.2.8 →
 * 19.3.0, arriving with the `minor-and-patch` Dependabot group. 28.6 KB measured as this
 * branch's build (311.17 KB) against the master it sits on (282.58 KB, `54b1196`), and
 * attributed by installing `react`/`react-dom@19.3.0` alone on that master, which
 * reproduces the eager total to within 4 bytes — `react-dom`'s own
 * `cjs/react-dom-client.production.js` grew 87 KB unminified between the two releases.
 * The other ten bumps in the group move nothing eager.
 *
 * Worth being plain about, because this is the budget's least comfortable case: every
 * visitor now downloads 28.6 KB more than last week, and no decision here bought it.
 * The build was checked for the cheap explanation first — a development or profiling
 * React slipping into the output — and it is a genuine production build: no
 * `react-dom.development`, no `Warning: ` strings, no `process.env.NODE_ENV` left
 * standing. So the cost is upstream and the only way to decline it is to decline the
 * upgrade.
 */
export const MAX_EAGER_BYTES = 316 * 1024

/**
 * Ceiling for any single lazily-loaded chunk.
 *
 * Today's largest is `sip.js`'s web platform at 237.11 KB, well ahead of the `comic-book`
 * skin at 205.65 KB — the pair have swapped places twice, so read the build rather than
 * this sentence when it matters. A lazy chunk is allowed to be much larger than an eager
 * one — that is the whole trade the code splitting buys — but not unboundedly so: past a
 * point the route that owns it is slow enough to feel broken, and the honest fix is to
 * split it again.
 *
 * **Which chunk this number is about changed with the cut recorded at the bottom of this
 * comment.** Every raise below is a comic-book raise, because comic-book was the binding
 * chunk for all of them; it is not any more, and the next branch to find this failing
 * should check which chunk failed before reading the history as though it were still
 * about the skin. A softphone change now moves this and a skin change may not.
 *
 * This raise (260 → 261) is 0.77 KB of `benDayTint.ts`, the lava-lamp colour drift through
 * the comic-book skin's Ben-Day ripple: a three-sine field and an RGB↔HSL round trip, so
 * each dot's hue can be turned a little way off the route accent. Measured as this
 * branch's build (260.29 KB) against the master it sits on (259.52 KB, `cc7f55e`), still
 * 46 chunks, `package.json` untouched. It is skin-local and lazy, so it is nobody's entry
 * cost, and it buys a background the eye can rest on for as long as a page stays open.
 *
 * The ceiling was 261 rather than flush against 260.29 for the reason {@link
 * MAX_TOTAL_JS_BYTES} gives: the default branch runs no gate, so a number set against one
 * branch's build is passed by the next two that merge in parallel.
 *
 * This raise (261 → 264) is the SMS thread fitting each balloon to its words and snaking
 * across the panel: 2.26 KB measured as this branch's merge of master (262.55 KB) against
 * a build of the same checkout with the branch's frontend changes reverted (260.29 KB,
 * same `node_modules` — the figure the paragraph above names for master). The bytes are
 * `bubbleFit.ts` (the text-fit estimate, which wraps without measuring), `chainLayout.ts`
 * (collision placement, interleave and zig-zag) and the row stamper in `bubbleChain.ts`
 * that gives each row its own width, stretch and lean. Still 46 chunks, `package.json`
 * untouched. 264 rather than 263 for the same reason as before: a kilobyte clear, not flush.
 *
 * This raise (264 → 268) is hiding a panel per window shape, deleting one outright, and
 * cutting either from the inspector or the toolbar: 3.71 KB measured as this branch's
 * build (266.95 KB) against a build of the same checkout with the branch's comic-book and
 * test changes reverted (263.24 KB, same `node_modules`). The bytes are
 * `configPanelsRemove.ts` (hide, show and delete over a whole config),
 * `panelGridAbsorb.ts` (which neighbour takes the freed space, and the cut that gives it
 * back) and `PanelActions.tsx`. 0.15 KB of the 3.71 is not the feature but the shape the
 * structural ratchet asked for: `useGridEdits` split into `useGridShape` and
 * `usePanelList` to come back under the 80-line function limit. Still 46 chunks,
 * `package.json` untouched.
 *
 * Note what this ceiling is really holding up, because the next raise should not have to
 * rediscover it: **31.2 KB of that 266.95 is the dev-only editor engine, shipping to every
 * production visitor.** `Layout.tsx` imports `useEditorMode` statically — it is a hook, so
 * the call cannot be conditional — and that one edge pulls in `useWorkingCopy`,
 * `useContentEdits`, `useCallEdits`, `useGridEdits`, `configPanels`, `configPages` and
 * `editorStorage`. Only the overlay's *UI* is behind the `import.meta.env.DEV` gate and
 * the lazy `import()`. Stubbing the engine out measures the chunk at 235.60 KB and the
 * total at 995.92 KB, so cutting that edge would put both roughly 30 KB clear and end the
 * run of raises this comment records. It is a hooks refactor with its own tests, not a
 * line to slip into a feature branch, so it is filed rather than done here.
 *
 * (Done now — the last paragraph below is what came of it, and the two figures this one
 * predicted are the two it measures.)
 *
 * This raise (268 → 269) is the pointer spotlight replacing the lava-lamp tint: 0.86 KB
 * measured as this branch's merge of master (267.81 KB) against a build of that master
 * alone (266.95 KB, `c373bb9`, same `node_modules` — the figure the paragraph above names
 * for its own branch, rebuilt here). `spotlight.ts` is the whole of it — one tracker every
 * surface samples, its raised-cosine falloff, and the eased follow and fade — and
 * `benDayTint.ts` with its three-sine field and RGB↔HSL round trip comes *out* in the same
 * change and is subtracted from it. So 0.86 KB is what a still grid lit by the cursor costs
 * over a drifting one, not what the spotlight weighs. 0.12 KB of the figure is not the
 * feature but the shape the structural ratchet asked for: `useLoadingScreen` split into
 * `useDotCycle`, `useLoadingGrid` and `useLeaveWash` to come back under the 80-line
 * function limit — the same trade the paragraph above records for `useGridEdits`, and
 * nothing added. Still 46 chunks, `package.json` untouched.
 *
 * The ceiling has to move for 0.86 KB because the raise above left it 1.05 KB clear and
 * this branch spends most of that: 268 would hold at 0.19 KB, which is the state the 981 →
 * 986 paragraph describes as a ceiling passed rather than raised. {@link
 * MAX_TOTAL_JS_BYTES} does *not* move for the same cost — it was left 1.73 KB clear and
 * still has 0.87 KB — and saying so here is the point, since the two have moved together
 * often enough that one moving alone would otherwise read as an error.
 *
 * **This is a cut, 269 → 239, and the first entry here that is not a raise.** 32.21 KB:
 * the editor engine, out of the production bundle at last, measured as this branch's build
 * (235.60 KB) against the master it sits on (267.81 KB, `1324a13`, same `node_modules`).
 * Both figures are the ones the filed paragraph above predicted, to the byte.
 *
 * What changed is one edge. `Layout.tsx` splits into a `Layout` that mounts the engine and
 * a `LayoutBody` that draws the page, the body reads editor state from a context whose
 * default is inert (`editor/editorContext.ts`), and `editor/EditorProvider.tsx` — reached
 * through the same DEV-gated `lazy()` the overlay already used — is the only thing that
 * ever fills that context in. No module was deleted and no feature moved; the editor is
 * exactly what it was in a dev session. Still 46 chunks, `package.json` untouched: the
 * provider does not become a 47th because a production build folds it away entirely.
 *
 * **239 and not 237, and the two kilobytes are the point.** The convention everywhere
 * above is a kilobyte of clearance, which would put this at 237 — and 237 fails, because
 * `web` is 237.11 KB and is now the chunk this number is about. So the clearance
 * comic-book gets here is 3.4 KB rather than 1.4, not as a favour to the skin but because
 * the binding constraint moved to another chunk and this ceiling has to clear *that* one.
 *
 * A guard came with the cut, because a ceiling is a poor way to say *this must not ship*:
 * {@link DEV_ONLY_MARKERS} greps the built JavaScript for a string only the engine needs.
 * That is what fails, naming the engine, if someone imports a mutator from the page again
 * — the 0.2 KB of headroom such an import would eat here is a much later and much vaguer
 * signal than the 32 KB it actually costs.
 *
 * **The second cut does not move this one, and that is the paragraph above's point
 * arriving.** Trimming `libphonenumber-js` took the comic-book chunk from 235.60 KB to
 * 205.65 — 29.95 KB, the largest single thing in it — and this number stays at 239,
 * because `web` is 237.11 KB and has been what it is about since the first cut. Two
 * consecutive 30 KB reductions in the skin and the ceiling has not moved once: it is not
 * the skin's budget any more. A comic-book branch now has 33 KB of room here and should
 * check {@link MAX_TOTAL_JS_BYTES}, which is where its weight still shows.
 */
export const MAX_LAZY_CHUNK_BYTES = 239 * 1024

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
 *
 * This raise (981 → 986) is the editor taking the file's version of a panel it is behind,
 * 3.34 KB measured as this branch's merge (984.3 KB) against the master it merges
 * (980.9 KB, `d6bcf4c`) — the same 3,417 bytes this branch measured against `2847dbe`
 * before three PRs landed on top of it, so the three cost nothing here and the delta is
 * this branch's alone. Note where that master already stood: 0.1 KB under a ceiling set a
 * kilobyte clear of the branch that raised it, spent by merges nobody re-measured — the
 * 971 → 972 paragraph's failure again — so this ceiling is set a kilobyte clear of 984.3
 * rather than flush against it.
 *
 * The bytes are the working copy's memory of the file it came from: `configDrift.ts`
 * diffs the recorded `seedBase` against today's seed per panel, and `configAdopt.ts`
 * splices one panel's entries back to the file's version, remapping every `linkTo` across
 * the splice. Both reach the build through `useWorkingCopy` ← `useEditorMode`, which
 * Layout.tsx imports statically. `StaleNotice.tsx`, which lists the drift and offers the
 * Take button, does *not* — it hangs off `EditorOverlay`, behind the `import.meta.env.DEV`
 * test, and its strings do not appear in `dist/`. Same lazy comic-book chunk, still 46 of
 * them, `package.json` untouched, so nothing new was pulled in.
 *
 * This raise (986 → 987) is the call layout's line — the number that is ringing or
 * answered, with the red key beside it — 1.16 KB measured as this branch's build
 * (985.84 KB) against a build of the master it sits on (984.68 KB, `0b6a872`, same
 * `node_modules`). The first measurement of this branch was 986.6 against 985.4
 * (`0173bc8`); it was re-measured here after #325 and #326 landed underneath, and the
 * delta is the same 1.16 KB, so neither of those cost this branch anything. Both builds
 * came down because #326 took the status artwork's branch out of `ProjectedTable`, and
 * that is why the ceiling is 987 rather than the 988 the first measurement asked for: a
 * kilobyte clear of 985.84, not of a number this branch no longer builds.
 *
 * The bytes are `BubbleNumberHangup.tsx` (the 'number-hangup' content kind), `BubbleKey.tsx`
 * (the one drawn key it and `BubbleCallKey.tsx` now share — the latter shrank by the same
 * markup), `CallScene.party` threaded from `ComicPanel` down to `BubbleBody`, `bubbleDrawn`
 * and `newEntryRole` in `callSceneRoles.ts`, and the phase the two add ops in
 * `configOps.ts` now take. All of it reaches the build through the comic-book chunk and
 * `useEditorMode`; the inspector's two new hints and the overlay's target filter are behind
 * the `import.meta.env.DEV` test and are not in this number. Same lazy comic-book chunk,
 * still 46 of them, `package.json` untouched, so nothing new was pulled in.
 *
 * This raise (987 → 988) is the projected table's row highlight: 0.57 KB measured as this
 * branch's build (987.26 KB) against a build of the same checkout with the changed skin
 * files reverted (986.69 KB, same `node_modules`). The bytes are `TableRowBand.tsx`, the
 * hovered-row state and its two pointer handlers in `ProjectedTable.tsx`, and
 * `filledRows`/`rowBand` in `tableData.ts`. Same lazy comic-book chunk, still 46 of them,
 * `package.json` untouched, so nothing new was pulled in.
 *
 * The CSS ceiling below does not move with it, and the reason is worth keeping: the band
 * is **one `background-color`**. It began as the number pad's glow — the same keyframes,
 * the same halo, the same pressed flare — which is 1.66 KB of CSS written a second time
 * and would have wanted a raise here as well. A row turns out to need none of it
 * (`table.css` says why), so what ships is a single flat wash, and 0.24 KB.
 *
 * This raise (988 → 1020) is the first here that `package.json` *is* touched for, and so
 * the first that every paragraph above ends by ruling out: the `minor-and-patch`
 * Dependabot group. 30.76 KB measured as this branch's build (1018.02 KB) against the
 * master it sits on (987.26 KB, `54b1196`), still 46 chunks.
 *
 * 28.59 KB of it is React 19.3.0 in the eager entry chunk — see {@link MAX_EAGER_BYTES},
 * which carries the attribution and the check that this is a production build. The
 * remaining 2.17 KB is lazy and nobody's entry cost: `lucide-react` 1.41 → 1.45 adds
 * 2.24 KB to the `carameli` skin chunk, against a few hundred bytes that came *out* of
 * `comic-book`, `candy-shop` and `web`. `libphonenumber-js` 1.13.12 → 1.13.13 is a
 * metadata patch and measures as nothing; the other seven bumps are dev-only toolchain
 * (`vite`, `cspell`, `happy-dom`, `knip`, `stylelint`, the two `@types`) and reach no
 * chunk.
 *
 * The ceiling is 1020 rather than flush against 1018.02 for the reason the 971 → 972
 * paragraph gives: the default branch runs no gate, so a number set against one branch's
 * build is passed by the next two that merge in parallel.
 *
 * This raise (1020 → 1022) is the same 0.77 KB {@link MAX_LAZY_CHUNK_BYTES} carries, and
 * nothing else: `benDayTint.ts` in the lazy `comic-book` chunk. 1020.61 KB on this branch
 * against 1019.84 KB on the master it sits on (`cc7f55e`), still 46 chunks,
 * `package.json` untouched. Both ceilings move because the skin chunk was within 0.5 KB
 * of one and the total within 0.2 KB of the other — a coincidence of timing rather than
 * two costs, and worth saying so, since a raise appearing in two constants at once
 * otherwise reads as a change twice the size of the one that happened.
 *
 * This raise (1022 → 1024) is the same 2.26 KB {@link MAX_LAZY_CHUNK_BYTES} carries, and
 * nothing else: the SMS thread's text fit and collision layout, all in the lazy
 * `comic-book` chunk. 1022.87 KB on this branch against 1020.61 KB with its frontend
 * changes reverted; the two deltas are the same 2,312 bytes, so nothing landed outside
 * that chunk. Still 46 chunks, `package.json` untouched.
 *
 * This raise (1024 → 1029) is the same 3.71 KB {@link MAX_LAZY_CHUNK_BYTES} carries, and
 * nothing else: hiding, deleting and cutting a panel, all in the lazy `comic-book` chunk.
 * 1027.27 KB on this branch against 1023.56 KB with its comic-book and test changes
 * reverted; the two deltas are the same 3,795 bytes, so nothing landed outside that
 * chunk. Still 46 chunks, `package.json` untouched. Both ceilings move for the same
 * reason the 1020 → 1022 paragraph gives — one cost, counted once, showing up in two
 * constants because the chunk sat within a kilobyte of one and the total within half a
 * kilobyte of the other.
 *
 * The pointer spotlight does *not* raise this one, and that is worth a line because every
 * comic-book change above raised both. It costs 0.86 KB — 1028.13 KB as this branch's
 * merge of master against 1027.27 KB for that master alone (`c373bb9`), the same 880 bytes
 * {@link MAX_LAZY_CHUNK_BYTES} measures, so again nothing landed outside that chunk. The
 * raise above left this ceiling 1.73 KB clear where it left the chunk's 1.05 KB, so the
 * same cost fits here and does not there. What is left is 0.87 KB, which is the clearance
 * the 971 → 972 paragraph asks for and not much more: the next comic-book branch should
 * expect to move this.
 *
 * **This is a cut, 1029 → 997.** The same 32.21 KB {@link MAX_LAZY_CHUNK_BYTES} carries
 * and nothing else — the editor engine leaving the lazy comic-book chunk, 995.92 KB on
 * this branch against 1028.13 KB on the master it sits on (`1324a13`), still 46 chunks,
 * `package.json` untouched. The two deltas are the same 32,987 bytes, which is how this
 * says the cut landed entirely in that chunk and took nothing else with it.
 *
 * Here the clearance is the usual kilobyte (1.08 KB), because unlike the ceiling above
 * this number really is a sum over every chunk and no one of them binds it.
 *
 * **A second cut, 997 → 967.** 29.95 KB, and this time not the skin's code but its
 * largest dependency: `libphonenumber-js` shipped every numbering plan on earth to format
 * a phone number, 82 KB of JSON of which 60% is the leading-digit regexes that pick a
 * format. `frontend/phoneMetadata.ts` keeps all 245 plans recognised and carries formats
 * for 44, which is 48.6 KB, and `phoneInput.ts` moved to `libphonenumber-js/core` to take
 * the table as an argument. 965.97 KB on this branch against 995.92 KB with the frontend
 * changes reverted; the same 30,671 bytes come off {@link MAX_LAZY_CHUNK_BYTES}'s chunk,
 * so nothing landed anywhere else. Still 46 chunks, `package.json` untouched — the table
 * is generated from the package that was already there, not a new dependency.
 *
 * Read the two cuts together: the chunk is 205.65 KB against the 267.81 KB of the master
 * this branch left, a quarter of it gone, and neither cut removed a feature.
 *
 * **This raise (967 → 969)** is the SMS composer wrapping its words and its balloon
 * growing to hold them: a `textarea` branch in `BubbleInput` with the layout effect that
 * grows it, `fitComposer`/`stretchFor` in `bubbleFit.ts`, the draft the chain now keeps to
 * fit against, and the caret's own wrap (`wrapCaretLines` and the two functions beside it)
 * so the lettered caret still finds the line it is standing on. 1.08 KB, measured as this
 * branch (991,212 B) against the same tree with `frontend/src` reverted (990,108 B), still
 * 46 chunks, `package.json` untouched. **All 1,104 bytes are in the lazy `comic-book`
 * chunk** (208,988 → 210,092 B) and no other chunk moved a byte, which is the shape a
 * skin-local change should have: it is nobody's entry cost.
 *
 * 969 rather than flush against 968.0 KB for the reason the paragraphs above give — the
 * default branch runs no gate, so the kilobyte of clearance is what lets the next branch
 * measure itself against a ceiling that still holds.
 */
export const MAX_TOTAL_JS_BYTES = 969 * 1024

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
 *
 * Not a raise, but the record matters: the SMS thread's `overflow-wrap: anywhere` rule
 * (`bubbleChains.css`) is 62 bytes against 0.21 KB of room. The same branch first
 * measured 0.63 KB over its base, and 0.57 KB of that was `.ordinal` — Tailwind scans
 * every `.ts` file under `src/` for class candidates, `ordinal` became a parameter name in
 * `chainLayout.ts`, and so the `font-variant-numeric` utility, its five `@property`
 * registrations and their defaults landed in the *eager* `index.css`, which every visitor
 * downloads. `src/index.css` now declines the word with `@source not inline(...)`, and
 * {@link STRAY_UTILITIES} is what fails if that line goes.
 *
 * This raise (48 → 49) is the SMS composer's wrapping field (`.cb-bubble-wrapping` in
 * `bubbleInputs.css`): the textarea defaults a balloon cannot have — the drag handle, the
 * scrollbar, the browser's own rows-tall box — plus the break rule the fit assumes of it.
 * 134 bytes against a build that had 60 of room, which is why a rule this small moves a
 * kilobyte ceiling. The check above is what says it is the *lazy* sheet: `comic-book.css`
 * 16,797 → 16,931 B with `index.css` unchanged at 32,295, so no identifier on this branch
 * became a Tailwind class candidate the way `ordinal` did.
 */
export const MAX_TOTAL_CSS_BYTES = 49 * 1024

/**
 * Utility classes the build must not contain.
 *
 * Tailwind reads every file its content globs name — every `.ts` and `.tsx` file under
 * `src/` — for anything that could be a class name, identifiers and comments included, so
 * a TypeScript parameter called `ordinal` is enough to emit `.ordinal`, its five
 * `@property` registrations and their defaults: 0.57 KB in the eager stylesheet for a
 * word no element carries. Each entry here is declined in `src/index.css` with
 * `@source not inline(...)`; {@link strayUtilities} against the real build is what
 * notices when that line goes, or when a new one is needed.
 */
export const STRAY_UTILITIES: readonly string[] = ['ordinal']

/**
 * Strings whose presence in `dist/` proves a dev-only module reached a production build.
 *
 * The counterpart to {@link STRAY_UTILITIES} for JavaScript, and it exists because a size
 * ceiling is a poor way to say *this particular thing must not ship*. The comic-book
 * editor's engine sat in the lazy skin chunk for five consecutive raises of
 * {@link MAX_LAZY_CHUNK_BYTES} — 31.2 KB of mutators downloaded by every visitor, none of
 * which a visitor can reach — because `Layout.tsx` imported the hook that owns it and a
 * hook cannot be called conditionally. The seam that cuts that edge is
 * `src/skins/comic-book/editor/editorContext.ts`; this is what fails when someone
 * reconnects it, and it fails *naming the thing* rather than as a chunk that grew.
 *
 * **Each entry is a literal that a test ties back to the constant it copies**, so a rename
 * in the source moves the needle instead of quietly emptying it. That check is the whole
 * reason this is a list of strings rather than an import: a marker that can silently stop
 * matching is a guard that reports green having looked for nothing, which is the failure
 * `.claude/rules/engineering.md` names and the one a build-output grep invites.
 *
 * A marker earns a place here by being a *string literal the module needs at runtime* —
 * minification renames every identifier but keeps those. `comic-book:editConfig` is the
 * localStorage key the editor's working copy is written under, reached only from
 * `configSeed.ts` → `configOps.ts` → the engine.
 */
export const DEV_ONLY_MARKERS: readonly string[] = ['comic-book:editConfig']

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

/** Every stylesheet in `dist/assets/`, joined — one string to search for a selector. */
export function readBuiltCss(): string {
  return listBuiltAssets()
    .filter(asset => asset.ext === '.css')
    .map(asset => readFileSync(path.join(DIST_ASSETS_DIR, asset.name), 'utf-8'))
    .join('\n')
}

/** `text` as a regex source that matches itself literally. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Which of `utilities` the stylesheet `css` still has a class selector for.
 *
 * A match is `.name` followed by anything that cannot continue a class name, so
 * `.ordinal{`, `.ordinal:hover` and `.ordinal,` count and `.ordinals` and `.ordinal-x` do
 * not — a stray utility is the exact word, and a project class that merely starts with
 * it is not the finding.
 */
export function strayUtilities(css: string, utilities: readonly string[]): string[] {
  return utilities.filter(name => new RegExp(`\\.${escapeRegExp(name)}(?![\\w-])`).test(css))
}

/**
 * Every `.js` file in `dist/assets/`, concatenated — the counterpart to
 * {@link readBuiltCss}, and read whole for the same reason: a marker may land in any
 * chunk, and which one it landed in is not the question being asked.
 */
export function readBuiltJs(): string {
  return listBuiltAssets()
    .filter(asset => asset.ext === '.js')
    .map(asset => readFileSync(path.join(DIST_ASSETS_DIR, asset.name), 'utf-8'))
    .join('\n')
}

/**
 * Which of `markers` appear anywhere in the built JavaScript.
 *
 * A plain substring test, not a regex: every marker is a literal the build reproduces
 * verbatim, so there is nothing to escape and nothing that can accidentally match.
 */
export function devOnlyMarkersIn(js: string, markers: readonly string[]): string[] {
  return markers.filter(marker => js.includes(marker))
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
  const pattern = new RegExp(`^${escapeRegExp(skin)}-[A-Za-z0-9_-]{${CHUNK_HASH_LENGTH}}\\.js$`)
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
