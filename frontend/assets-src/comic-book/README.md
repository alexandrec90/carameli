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
python scripts/encode-comic-art.py            # every master with no export yet
```

Name the masters when you want `--label` or a different `--max-edge`; name none when
you have just dropped files in and want them encoded at the defaults. The no-argument
form is what the *Assets: Encode Comic-Book Art* task in the workspace runs, and it is
safe to repeat: an export that already exists is skipped unless you pass `--force`.

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

Cold is the operative word, and until 2026-08-27 `frontend/assetPolicy.ts` priced it as
though it were not. A `MAX_PUBLIC_BYTES` cap weighed the whole of `public/`, so a
picture in the dropdown that no layout draws counted against the same number as the
panels on the home page — and adding artwork failed the suite as a payload regression
against a download nobody makes. The budget is per page now (`MAX_PAGE_BYTES`), so an
unplaced picture costs nothing until a layout draws it, and then costs exactly the page
that draws it. What still bounds a cold export is `MAX_CONTENT_IMAGE_BYTES` on the file
itself and the reference check, which deletes whatever nothing names.

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
the command above names because they are the two it was first run on — and so are
`monogram.png` and the four bubble drawings, registered as selectable art by the change
that added this sentence (see *The traced references*). `logo2.png`,
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

## The telephone's keys

`call-button.png` and `end-call-button.png` are the green and red keys an `actions`
speech balloon draws. They are served — `public/comic-book/call-button.webp` and
`end-call-button.webp` — and they are encoded small, because a key is not a panel:

```bash
python scripts/encode-comic-art.py call-button end-call-button --max-edge 256
```

256px against the ~1408px default is ~29 KB for the pair against several hundred, and
the saving matters more here than for any other export — a balloon draws these on
whatever page it sits on, so unlike a panel picture they are charged to **every** page's
`MAX_PAGE_BYTES` in `frontend/assetPolicy.ts` rather than to the one page that draws
them.

Until this change they were also the one kind of export encoded with `--no-register`,
kept out of `PANEL_ASSETS` so that the editor's **picture** dropdown could not offer a
button where an author expects a photograph. They are registered now. The dropdown is
the only way to put artwork in a panel, so keeping them out did not prevent the mistake
so much as prevent the deliberate use — a key drawn as panel art is a legitimate frame,
and an author who wants one had no way to ask for it. The flag stays for an export that
genuinely should not be offered; these are not it.

`assetPolicy.test.ts` is satisfied either way, and for a reason worth keeping straight:
the paths are named in `frontend/src/skins/comic-book/phoneActions.ts` — where the label
an author types (`Call`, `End call`) is folded onto the artwork and onto what the key
does — and that is app source, a *loading* reference. A line in `PANEL_ASSETS` alone
would not have been: the dropdown is behind `?edit=1` on a dev server, so it is listed
in `NON_LOADING_SOURCES` and buys an asset nothing.

## The traced references

`cloud bubble.png`, `jagged bubble.png`, `lightning bubble.png` and `soft bubble.png`
are first of all source documents: each is a drawing whose outline was sampled into a
vertex table, and `boltShape.ts` and `bubbleShape.ts` draw those bubbles as SVG at
runtime from the table, never from the picture. Nothing in the app fetches one to put a
bubble on the screen, and nothing should.

Their `.webp` exports shipped in `public/` for months anyway, unnamed by any source,
because nothing in a build can tell an unreferenced file from a referenced one. They are
back, and this time with a line in `PANEL_ASSETS`: a bubble drawing is a perfectly good
picture to place in a panel deliberately, which is a different claim from the one that
put them there the first time. `monogram.webp` arrives on the same terms — the CM mark
is the source the icon set is generated from, and also a picture worth being able to
draw.

Registered is not loaded: the dropdown is behind `?edit=1`, so `assetPolicy.ts` counts
these against no page's budget until a layout actually draws one. That is what makes
"available in the editor" cheap enough to be the default answer for a generation nobody
has placed yet.

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
