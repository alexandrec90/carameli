# Comic-book image masters

The Gemini-generated PNGs the shipped `.webp` panel art was encoded from, plus
`monogram.png`, the CM mark the favicon/PWA icon set is generated from, plus a few
generations nothing draws yet — see *Art with no layout* below.

**Nothing here is served.** These files sit outside `public/` on purpose: Vite
copies `public/` into `dist/` verbatim, so while they lived there every build
carried ~24 MB of PNG that no page ever requested — `layoutConfig.ts` and the
`PANELS` list the skin guard in `index.html` preloads from both name `.webp` only,
and have since the WebPs were encoded.

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

## Art with no layout

`conversation.png` is a newer generation that no layout draws. It is a master on the
same terms as the rest of this directory — the only lossless copy, kept for that
reason — with one difference: it has no `.webp` in `public/`, and should not get one
until something renders it.

That is not bookkeeping. `public/` is a served tree with a byte budget, and
`frontend/assetPolicy.test.ts` fails on a file in it that no source references, so an
export encoded ahead of its layout does not wait quietly for the code to catch up — it
fails the suite as dead weight. Encode from here when the layout lands, using the
`sharp-cli` line above.

This section used to name `logo2.png`, `man-woman-talking.png`, `notepad.png` and
`push-button-phone.png`. All four have since been encoded and drawn — `layoutConfig.ts`
and the editor's `assets.ts` reference every one — so the list was describing a state
that had passed. A file leaves this section when its layout lands, not when its `.webp`
is written; nothing fails if the paragraph is left stale, which is exactly why it has to
be edited by hand in the same change.

Those four arrived by exactly the route this directory exists to prevent: generated
straight into `frontend/public/comic-book/`, masters and exports side by side, in a
static checkout sitting on `master`. Nothing rendered them, so nothing failed, until the
policy test read the tree. `conversation.png` arrived the better way — into
`assets-src/`, with no export — and is committed here waiting for a layout.

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

What neither can see is an asset that *is* referenced by a page that never draws it:
every static check passes, because every reference is real. That takes a browser, and
`tests/e2e/test_asset_usage.py` is it — it loads each skin, compares what the network
fetched against what the layout used, and fails on the difference.
