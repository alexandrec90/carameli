import type { KnipConfig } from 'knip'

/**
 * Dead-weight detection for the JavaScript side: files nothing imports, exports nothing
 * reads, and dependencies nothing uses.
 *
 * The counterpart to `assetPolicy.ts` on the served tree and `bundlePolicy.ts` on the
 * build, and it exists because the same blind spot runs through all three. Vite
 * tree-shakes an unused module out of the bundle silently, so unused code costs nothing
 * a byte budget can see and everything else: `npm ci` time in every CI job, a Dependabot
 * PR every time it releases, an audit finding when it has one, and a reviewer's attention
 * when they have to work out whether it matters. Five three.js packages sat in
 * `dependencies` for months on exactly that basis — 31 MB installed, zero bytes shipped,
 * imported by nothing since the skin that used them was rewritten.
 *
 * Almost everything here is inferred: knip reads `index.html`, `package.json` and the
 * config files to find entry points on its own, and an explicit `entry` list mostly
 * duplicates what it already knows and then goes stale. What it cannot infer is the
 * handful of things reached from outside the TypeScript graph, which is what this file
 * is for. Each entry says why, because an unexplained exemption is indistinguishable
 * from having given up.
 */
const config: KnipConfig = {
  // Reached from outside the import graph, so knip has to be told they are roots.
  entry: [
    // Written into by `.claude/skills/add-skin/scripts/scaffold.py`, which registers
    // each new skin's button here. No page renders it today, so knip sees a dead file
    // and is right about the graph and wrong about the repo — the scaffold breaks if it
    // goes. An entry rather than an `ignore` so what it imports still counts as used;
    // `useSkinSwitcher` in `skins/context.tsx` has no other caller. Worth revisiting as
    // a question about the switcher, not about knip.
    'src/components/SkinSwitcher.tsx',
  ],

  ignoreDependencies: [
    // Run as `npm --prefix frontend exec -- markdownlint` from `scripts/diagnostics.py`.
    // Installed here because that is where the node_modules is, invoked from Python, so
    // no import anywhere names it.
    'markdownlint-cli',
    // Required by `scripts/compress-images.js` at the repo root, which reaches into
    // `frontend/node_modules/sharp` for the same reason.
    'sharp',
  ],

  // A module's own file is not evidence that anything outside it wants the export, but
  // reporting every locally-consumed helper drowns the findings that matter.
  ignoreExportsUsedInFile: true,
}

export default config
