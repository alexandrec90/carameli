# Comic-book image masters

The Gemini-generated PNGs the shipped `.webp` panel art was encoded from, plus
`monogram.png`, the CM mark the favicon/PWA icon set is generated from, plus a few
generations nothing draws yet — see *Adding a new picture* below.

**Nothing here is served.** These files sit outside `public/` on purpose: Vite
copies `public/` into `dist/` verbatim, so while they lived there every build
carried ~24 MB of PNG that no page ever requested — `layoutConfig.ts` and the
`PANELS` list the skin guard in `index.html` preloads from both name `.webp` only,
and have since the WebPs were encoded.

Keep them. They are the only lossless copies, and re-encoding a `.webp` from a
`.webp` compounds the loss.

`switchboard.png` is 2816×1536 and the shipped `.webp` still is; no panel is drawn
anywhere near that wide, so a resize pass on re-encode is the cheap win left in
this directory. See `.claude/rules/skin-comic-book.md`.

## Adding a new picture

Drop the master here, then run, from the repo root:

```bash
python scripts/encode-comic-art.py conversation hand-notepad
```

That does two of the three steps, and the second is what makes the first legal:

1. **Encode it into `public/comic-book/`**, bounded to a long edge of ~1408px rather
   than the master's — `--max-edge` and `--quality` override the defaults, and
   `--force` re-encodes over an export that already exists.
2. **Add a line to `PANEL_ASSETS`** in
   `frontend/src/skins/comic-book/editor/assets.ts`. The dropdown cannot enumerate a
   served directory, so a picture with no line there is unreachable from the editor —
   and, because `frontend/assetPolicy.test.ts` fails on a file in `public/` that no
   source references, an export with no line there also fails the suite as dead weight.
   The label comes from the file name; `--label "Two agents talking"` names it properly.

Placing it in a panel is a third, separate step, done in the editor (`?edit=1`, select
a panel, **+ Image**) and saved into `editor/layoutConfig.ts`. Between step 2 and that,
the file is selectable art costing its own bytes in every build: real, but cold.
`MAX_PUBLIC_BYTES` in `frontend/assetPolicy.ts` is what keeps that from being free —
encoding ahead of a layout is a decision about what visitors download, and raising the
cap is where it reads as one. The script reports the served tree against that budget
and refuses to raise it for you.

**The encoder call is in the script, not in this file, and that is deliberate.** What
stood here was a `sharp-cli` invocation in that tool's pre-6 spelling: it passed the
format as a trailing `-- webp --quality 82` and pointed `-o` at the export rather than
at a directory, so following it exited with `Unknown argument: webp` having written
nothing — which reads as a broken image, not as a stale command. Nothing failed when it
drifted, because nothing ran it. `sharp-cli` was never a dependency here either, so
each of those calls was an `npx` fetch over the network, while `sharp` itself is in
`frontend/package.json` already. `scripts/hooks/tests/test_encode_comic_art.py` pins
the call the script makes.

`conversation.png` and `hand-notepad.png` are at that stage today — they are the two
the command above names because they are the two it was first run on. `logo2.png`,
`man-woman-talking.png`, `notepad.png` and `push-button-phone.png` were, until the
home page's four panels landed and started drawing them. A file leaves this list when
its layout lands, not when its `.webp` is written; nothing fails if the paragraph is
left stale, which is exactly why it has to be edited by hand in the same change.

Those four arrived by the route this directory exists to prevent: generated straight
into `frontend/public/comic-book/`, masters and exports side by side, in a static
checkout sitting on `master`. Nothing rendered them, so nothing failed, until the
policy test read the tree. `conversation.png` and `hand-notepad.png` arrived the better
way — into `assets-src/` first, with the export written from here in the change that
registered it.

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
