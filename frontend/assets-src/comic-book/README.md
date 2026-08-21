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
