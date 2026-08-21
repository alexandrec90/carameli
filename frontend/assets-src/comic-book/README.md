# Comic-book image masters

The Gemini-generated PNGs the shipped `.webp` panel art was encoded from, plus
`monogram.png`, the CM mark the favicon/PWA icon set is generated from.

**Nothing here is served.** These files sit outside `public/` on purpose: Vite
copies `public/` into `dist/` verbatim, so while they lived there every build
carried ~24 MB of PNG that no page ever requested — `layoutConfig.ts` and the
`<link rel="preload">` list in `index.html` both name `.webp` only, and have since
the WebPs were encoded.

Keep them. They are the only lossless copies, and re-encoding a `.webp` from a
`.webp` compounds the loss. Re-encode from here when a panel needs a new size:

```bash
# one panel, at the width it is actually displayed at
npx sharp-cli -i "assets-src/comic-book/switchboard.png" \
              -o "public/comic-book/switchboard.webp" \
              resize 1408 -- webp --quality 82
```

`switchboard.png` is 2816×1536 and the shipped `.webp` still is; no panel is drawn
anywhere near that wide, so a resize pass on re-encode is the cheap win left in
this directory. See `.claude/rules/skin-comic-book.md`.

## The traced references

`cloud bubble.png`, `jagged bubble.png`, `lightning bubble.png` and `soft bubble.png`
are not panel art and were never encoded for display. Each is a drawing whose outline
was sampled into a vertex table — `boltShape.ts` and `bubbleShape.ts` draw those
bubbles as SVG at runtime, so the picture is a source document, not an asset. Their
`.webp` exports shipped in `public/` for months regardless, because nothing in a build
can tell an unreferenced file from a referenced one.

`frontend/assetPolicy.test.ts` can now: it reads every file in `public/`, collects
every asset path named anywhere in `src/`, `index.html`, `manifest.json`, this file
and `.claude/rules/`, and fails on either side of the mismatch. So a master copied
into `public/` fails as dead weight, and a path in the prose above fails once the file
it names has moved. The budgets and the `.webp` rule live in `frontend/assetPolicy.ts`
as constants — lowering one after a resize pass is a one-line diff.
