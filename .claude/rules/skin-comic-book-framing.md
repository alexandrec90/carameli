---
description: Comic Book skin per-panel framing reference — layoutConfig.ts as source of truth, projected table surfaces, and the dev-only visual editor
paths:
  - frontend/src/skins/comic-book/**/*.ts
  - frontend/src/skins/comic-book/**/*.tsx
  - frontend/src/skins/comic-book/**/*.css
---

# Rule: Comic Book Skin — Per-Panel Image & Bubble Framing

> **Scope:** the reference half of `.claude/rules/skin-comic-book.md`, split out of it so
> neither file grows past the instruction-size limit. The design doctrine — palette,
> layout, component patterns, motion, and the Hard Rules Summary — stays there; what is
> here is how a panel's contents are *framed* and how the editor authors that framing.

## Per-Panel Image & Bubble Framing

`editor/layoutConfig.ts` is the **source of truth** for the panel shapes themselves
(`PANEL_GRIDS`), for picture placement and framing
(`PANEL_IMG_TRANSFORMS`: panel / src / alt / left / top / width / height / scale /
offsetX / offsetY / anchor / spill, with `src` drawn from the `PANEL_ASSETS` manifest
in `editor/assets.ts`) and speech-bubble
placement and behaviour (`PANEL_BUBBLE_TRANSFORMS`: panel / top / right / width /
rotate / spill / type / tail / content / text, plus `hoverType` / `clickType` event
morph targets, `hoverBold` for a heavier outline under the pointer — the balloon's own
only: its tail and puffs bold with it, a tube and the balloon at the far end of one do
not — the `linkTo` tube partner and the `chain` this balloon is a slot of;
content may be lettering, a wheel picker, a text input, a locale-formatted phone
input, a dial — an autocomplete over that phone input, its list drawn as the wheel — or
the telephone's own call/end-call keys) and the chain settings those names resolve to
(`PANEL_BUBBLE_CHAINS`),
plus each panel's background pattern style
(`PANEL_PATTERNS`, the one array parallel to `PANELS` — which lives in the same file,
since the editor appends to it when a panel is split; the per-panel palette and dot
metrics stay in `PANEL_BG_CONFIGS` in `panelPatterns.ts`, read through `panelBgConfig`
so a panel past the palette's end wraps round). The renderer in
`Layout.tsx` reads from these arrays — there are **no magic framing numbers** in
`Layout.tsx` or the CSS for images/bubbles, and no bubble text. To retune them, use
the editor rather than hand-editing scattered values.

**Save overwrites `layoutConfig.ts` verbatim** with what `serialize.ts` emits, so
anything that module does not write is deleted on the first save. That is why the
file's explanatory comments are emitted as headers by `serialize.ts`, and why nothing
else — a `NEW_IMAGE` or `NEW_BUBBLE` default, a helper — may live in `layoutConfig.ts`.
Config edits themselves live in `configOps.ts` (React-free: seed/hydrate/patch,
add/remove picture or bubble, pattern switch, link sanitation), which re-exports
`configSeed.ts` and `configHydrate.ts` (backfill, enum coercion, pattern fallback);
grid edits live in `panelGridOps.ts` and the chain list's own lifecycle in
`chainOps.ts`; `reconcile.ts` settles links, ids and the list after any bubble-touching
edit, `chainCreate.ts` builds a whole conversation in one op, and `chainFrame.ts` is the
editor-only geometry of where its rows land.

**A `layoutConfig.ts` you did not edit is somebody's unsaved design, not a broken
branch.** Because Save writes the served tree directly, a browser tab left open mid-
design plants half-built balloons in whatever worktree the dev server was running in,
uncommitted and belonging to no PR. That has stranded four trees so far, each costing a
fresh session a diagnosis, because the parity failures it produces read as a fault in
whatever branch happened to be checked out. The first assertion in `default config
parity` now says so in its own failure message, and the answer it gives is the right
one: `git stash push -- frontend/src/skins/comic-book/editor/layoutConfig.ts`, never
filling in the missing tails by hand — that silently overwrites work someone is still
doing.

The bubble box's on-screen geometry comes from `bubbleRect` in `transforms.ts`, used
by **both** the renderer (to aim tubes) and the editor (hit target and selection
outline). Keep it shared: when those two disagreed, the bubble you could click was
not the bubble a tube pointed at.

## A picture can be a projected table surface

Any picture may carry an optional `table`, which draws an HTML table onto the surface the
picture depicts — a notepad's ruling, a whiteboard, a screen. The field is **absent** on a
picture that is not a surface; absence is how that is spelled in `configSeed.ts`,
`configHydrate.ts` and `serializeTable.ts` alike, so `'table' in img` is a reliable
question. Nothing about the feature is skin chrome: it is per-picture data, so the same
switch turns any picture into a surface.

**The tilt is a projective map, not a rotation.** `tableProjection.ts` takes the author's
four corners (`quad`, in % of the picture's **rendered rect** — the artwork's own pixels,
via `surfaceBaseRect`, so a window resize, pan or zoom carries the surface with the
photograph instead of leaving it glued to the frame's letterboxing), solves the homography
carrying the
unit square onto them, and emits one `matrix3d`. Matching a plane in a photograph with
`rotateX`/`rotateY`/`perspective` is a three-way search where each axis undoes the last;
four corners dragged onto the four corners in the picture are a unique answer and need no
search. The table is laid out at `quadSourceBox` — the mean of the quad's opposite edges —
rather than at the frame, because a 3D-transformed element is rasterised once at its
layout size and a table laid out four times too large is downsampled lettering.

**Rows snap because the offset is an index, not a position.** The surface divides into
`rows` equal bands in un-projected space, and scrolling advances an integer index into
`data`, so band *k* renders in exactly the same place at every offset and stays on the line
drawn in the picture. Rows outside the window are never rendered, which is also why there
is no scrollbar to hide — there is no scroll container. The wheel accumulates sub-row
travel (`wheelRows` carries the remainder) so a trackpad's dozen small deltas still move a
row. Two off-screen buttons and an `aria-live` row count are the keyboard's version of the
wheel; without them the rows past the first window are reachable by exactly one device.

Editor chrome — the dashed outline, the per-band guides, the corner grips — is drawn only
while the editor is open, and is drawn *through the same projection as the rows*, which is
the point: a guide that lines up with the picture's ruling is a guide the rows line up with
too.

**A surface can show live records instead of authored cells.** `table.source` names a feed
— `'calls'` or `'sms'`, the members of `TABLE_SOURCES` in `lib/liveTables.ts` — and is
**absent** on a surface whose cells the author typed, the same way `table` itself is absent
on a picture that is not a surface. The skin names a feed and is handed rows; it does not
fetch. `hooks/useLiveTables.ts` is the only module in the chain that touches the API, and
`lib/liveTables.ts` owns the column list and the record-to-row mapping, so neither the
customer id nor an endpoint appears anywhere under `skins/`.

The rows are injected in `Layout.tsx`, between the editor's working copy and the panels
(`useLiveTableImages`), which is what keeps every component below it — `ComicPanel`,
`PanelImages`, `ProjectedTable` — unchanged and renderable from a plain config in a test.
It also keeps the *editor* holding the authored surface: the working copy never sees a
record, so **Save** writes `data: []`.

Three consequences worth stating, because each one is a bug the obvious implementation has:

- **`data` stays empty for a live surface, and that is a privacy invariant, not tidiness.**
  The feed is call and message history; rows saved beside it would put real phone numbers
  into `layoutConfig.ts` on the first save. It is enforced three times — the injection is
  downstream of the editor's config, `coerceTable` empties `data` when a source is set, and
  the inspector's feed switch replaces the cells.
- **A live surface's columns are the feed's**, because the mapper emits cells positionally.
  Widths, alignment and heading wording stay the author's — that is how a feed is fitted to
  the ruling in the photograph — but the editor hides **+ Column** and **−** while a feed is
  on, since removing the second column would slide every value one heading left.
- **Live means polling** — there is no push transport in this frontend. `useLiveTables`
  re-asks every `LIVE_TABLE_POLL_MS`, skips a hidden tab and refreshes on `visibilitychange`,
  and returns the *identical* row array when nothing changed, so a quiet poll does not
  repaint every Ben-Day canvas on the page. A failed refresh keeps the rows already on the
  surface rather than blanking the notepad.

## An `actions` balloon is the telephone's keypad, not a toolbar

A balloon whose content is `actions` letters one button per comma-delimited entry, except
for the two labels naming the drawn telephone's own keys: `Call` and `End call` render
their artwork from `public/comic-book/` instead. `phoneActions.ts` owns both halves of
that — the label→key fold (on letters alone, so `end-call` and `END CALL` are the same
key) and the softphone verb each key runs — and it is pure, so the mapping is unit-tested
without a render.

Three properties are the design, not incidental:

- **Two keys, four states.** Green answers a ringing call and otherwise dials
  `dialTarget`; red declines one and otherwise hangs up. A handset has one green key and
  one red one whatever the call is doing, so a third and fourth button never appear.
- **A key with nothing to do is disabled, never hidden.** A control that vanishes off a
  photographed telephone reads as a fault in the picture. `bubbleInputs.css` greys a
  disabled key only under `.is-interactive`, so the editor still shows the artwork whole.
- **The handlers are props, all the way down** — `Layout` → `ComicPanel` → `PanelBubbles`
  → `PanelBubble` → `BubbleActions`. Nothing under `skins/` reaches for the softphone
  hook, so every one of those renders from a plain config in a test, and a balloon with no
  handlers is drawn and inert rather than broken.

The number dialled is `dialTarget`, which the projected number pad types into. A `phone`
balloon is the other way to place a call and holds its number in a field of its own; the
two are not the same input, which is why the keys take no argument.

## A panel is a phone call for as long as something on it carries a role

A live call splits one panel down a seam and draws the two ends of it facing each other.
That is a *second layout for that panel*, not a widget: the same pictures and balloons
the editor already places, framed against half a panel instead of a whole one.

**Membership and role are one optional field.** `call?: CallRole` on an `ImgTransform` or
a `BubbleTransform` says both that the entry belongs to the panel's call layout and which
part of it: `ringing` and `remote` are the far end before and after the pickup, `local` is
the caller, `scene` spans the whole panel. **Absence — never `null` — is the panel's
ordinary layout**, so a panel with no roles on it is an ordinary panel and the switch
needs no flag of its own. `callSceneRoles.ts` owns every question asked of a role, so the
drawing and the editor's click targets cannot disagree about where a picture is.

Three consequences are the design:

- **`PANEL_CALL_SCENES` is derived, and holds only the seam.** `syncCallScenes` rebuilds
  it in `reconcile` from the roles the entries carry, so "add a scene" and "delete a
  scene" are not operations: a scene with no members, and a role with no scene, are states
  the editor cannot reach. What the record *does* hold is the cut and the axis — the one
  thing no entry can imply.
- **The two far-end roles share a half.** An author who framed the ringing telephone has
  framed the person who answers it; splitting them would jump the picture across the panel
  at the pickup and need a second framing to stop it.
- **The keys are an ordinary `actions` balloon**, lettered `End call` and folded to the
  softphone by `phoneActions.ts` like every other key on the page — so hanging up is not a
  callback the scene owns, and the balloon can be moved, resized and re-lettered.

Anything drawn against a half is measured against **that half's box**, by `halfFor`, in
all three places at once: the picture, the click target, and the drag. A target measured
against the panel sits where its picture is not, and a drag scaled by the panel travels
about twice as far as the pointer.

## A field is typed into as soon as its panel lights up

There is no click-to-focus on a page drawn as artwork: the panel revealing its balloons
*is* the invitation, so a field takes the keyboard the moment that happens. That is a
property of **every** field — `input`, `phone`, either dial, a chain's composer — and not
of the two balloons it was first written for.

`panelKeyboard.ts` owns it, as a claim per balloon settled per panel. `PanelBubbles` is
the router: it collects the claims, tracks which balloon the pointer is on, and hands
exactly one balloon `keyboard`. A balloon never decides for itself, because the answer
depends on what else is drawn beside it — which is precisely what a balloon cannot see.

| Claim | Who | Owns the panel when |
| --- | --- | --- |
| `CLAIM_COMPOSER` | a chain whose sender template is a field | nothing outranks it and nothing is hovered |
| `CLAIM_FIELD` | `input`, `phone`, `dial`, `dial-call` | it is the only field on the panel |
| `CLAIM_POINTER` | `wheel` | only while hovered — it takes the scroll, so a composer beside it must let go |
| `CLAIM_NONE` | lettering, `actions` | never |

Three rules decide it, in order: **the pointer wins**, then **the highest claim wins if
it stands alone**, then **a tie owns nothing**. So one field on a panel needs no gesture,
a composer beside a dial keeps the keyboard until the dial is hovered, and two plain
inputs wait — posting keystrokes into whichever the config happened to list first is not
a fact the reader can see on screen.

**Never re-spell this inside a balloon.** Two components used to carry a private half of
it each — a dial focused itself while revealed, a composer took the keyboard off the
picker — which is why an `input` balloon drawn anywhere else sat there ignoring the
keyboard until it was clicked. A new content kind joins by naming a claim in
`bubbleClaim`, and a new panel-level owner by ranking above `CLAIM_FIELD`.

## Dev-only visual editor

| Property | Value | Notes |
| --- | --- | --- |
| Enable / disable | `?edit=1` / `?edit=0` in dev | Flag persists in `localStorage['comic-book:edit']`; `?edit=0` clears it |
| Gate | `import.meta.env.DEV && (?edit=1 \|\| flag)` | Never ships — `?edit=1` is inert in prod |
| Select | click a **panel**, a **picture** or a **bubble** | A picture wins over the panel under it, a bubble over both; a panel is only outlined — it is the slot the **+** buttons add to, where its **name** and background pattern are edited, and (in shapes mode) what the split buttons cut. Panels are selectable in both modes |
| Adjust | drag / wheel / handles / arrows | Move the frame or bubble, resize (bottom-right grip), pan the picture inside its frame (top-left grip, picture only), rotate (top-right grip, bubble only), nudge (⇧×10); for a picture **Alt** swaps the two framings |
| Add / remove | **+ Image** / **+ Bubble** / **+ SMS** toolbar buttons, **Delete image** / **Delete bubble** in the inspector | Adds to the selected panel; deleting a bubble clears any link naming it |
| Panel fields | inspector controls | **name** (free text) and background **pattern** style (`PATTERN_STYLE_KEYS`; palette stays per panel) |
| Picture fields | inspector selects | panel, picture (`PANEL_ASSETS`), alt (empty = decorative), anchor, spill |
| Bubble fields | inspector selects | panel, type, **tail** (nine options incl. **No tail**), **content** (Text / Wheel picker / Text input / Phone input / Dial / Action buttons), authored text or initial value, hover/click morph, link. There is **no chain control**: a conversation is made whole by **+ SMS** and never assembled here |
| Chain fields | inspector, below the bubble's own, when the bubble is in a chain | **rows**; **messages** on an *unbound* chain only (one per line; empty = speak the balloons' own text); **+ Other column** and **+ Number picker** when either is missing. They edit the conversation, not the selected balloon. Chained balloons render flat in edit mode so each stays selectable, and the table's extent is drawn as a dashed frame (`chainFrame.ts`) so moving a template or changing `rows` has a visible result |
| Make a call | **+ Call** toolbar button | Turns the selected panel into a phone call: three pictures and three balloons carrying `call` roles, plus a centred seam. Any panel will do — the button is disabled, with the reason in its title, only on one that is already a call. There is no "delete a call": clear the last role and the scene goes with it |
| Call layout | **Call layout** group in the toolbar — **Default** / **Ringing** / **Connected** | Which layout every call on the page is showing, so a call can be framed at either moment. The group appears only once the page has a call on it. This is the switch the whole feature turns on: on Default the call's entries are off screen and have no targets, outlines or drags |
| Call role | **call role** select (any picture or balloon inspector) | *Not part of a call* plus the four roles (`CALL_ROLE_LABELS`). Choosing one puts the entry in the panel's call layout and moves the page to the layout it just joined — otherwise nothing would appear to have happened. Clearing one returns the page to Default |
| Call seam | **call seam** range + **call split** select (panel inspector) | Where the panel is cut and which way — side by side or one above the other. Bounded by `CALL_CUT`, since a cut at the edge leaves a half with no area and nothing to drag it back by. Only on a panel that is a call |
| Table on / off | **Project a table onto this image** checkbox (picture inspector) | Switching on seeds a starter surface; switching off deletes the table and its cells, leaving the picture |
| Table source | **shows** select (table inspector) | *Cells typed below* or a live feed (**Call records**, **SMS messages**). Picking a feed takes its columns and empties the cells; going back seeds a fresh authored surface, since five empty feed-shaped columns would leave nothing on the notepad to see |
| Table fields | inspector controls | rows visible, text size, ink, headings on/off, the four corner X/Y pairs, **Reset corners**, and a columns list (heading / width weight / alignment) plus the cell text, one row per line, tab- or `\|`-separated. A live surface has no cell block, and no **+ Column** / **−** |
| Table corners | drag the four **square grips** | Only on the selected picture, only in content mode. The band guides move with them, so align the guides to the ruling in the photograph |
| Pages | **Page** dropdown in toolbar | Switch route in edit mode (replays the wash); "Loading screen" entry previews the loading overlay + its exit wash |
| Mode | **Content** / **Panel shapes** toggle | Content places pictures and bubbles; shapes drags the lines between panels. Picture and bubble click targets are not rendered in shapes mode — a picture-sized target would swallow every drag aimed at a line crossing it. Panel targets stay, painted under the seam layer so a line or corner across one still wins the pointer |
| Reshape | drag a **line** or a **vertex** | A frame vertex slides along its own edge; the four corners are locked; the frame itself has no handle. Arrows nudge (⇧×10). Pictures and bubbles hold their on-screen place — each affected frame and balloon is re-expressed against its new panel box (`editor/gridContentRemap.ts`); the polygon clip alone follows the seam |
| Bend | **double-click a line** (or **Add a corner to this line** on the selected line), drag the bend; **Delete** / **Straighten** removes it | Repeat for lightning bolts. A junction of three lines, or a vertex on the frame, is not a bend and is refused |
| Merge | drag a corner **onto another corner** and release | Within snap range the target lights up and the dragged corner sits on it; releasing collapses the two into one junction (`panelGridMerge.ts`). Refused — no snap offered — when the merged grid would be invalid or the two corners obey different frame constraints |
| Tear | **Alt-drag a corner** | The inverse of the merge: the seams on the drag side follow the pointer, the rest stay, and the two corners end up joined by a new edge (`panelGridSplit.ts`). The torn corner snaps onto a neighbouring seam's continuation line, so a collapsed cross folds back into two junctions on one straight seam. While the result would be invalid nothing tears |
| New panel | select a **panel**, then **Split top / bottom** or **Split left / right** in the shapes inspector | A straight cut through the middle of the panel's box, in all three grids of its page at once (`configPanels.ts` over `panelGridCut.ts`). The parent keeps its index, name, pattern and the upper/left half; the new panel is appended to `PANELS` with a numbered name and the parent's pattern, the other page's grids gain an empty ring, and on the grid on screen pictures and bubbles hold their place (`gridContentRemap.ts`). Refused whole, with a note, when any grid cannot take the cut. There is no delete |
| Reset shapes | **Reset shapes** in the shapes inspector | Restores the current window shape's grid only — the three are edited independently. Pictures and bubbles stay where the author put them. A panel added since shipping has no shipped ring, so it is left empty on that window shape until split off again |
| Save | **Save** button | `POST /__comic-editor/save` writes `layoutConfig.ts` (dev server only); **Copy config** / **.ts** are the fallbacks. Never refused — mid-design is when it matters most |
| Ship | **Ship** button + summary | `POST /__comic-editor/ship` saves, then branches, commits, pushes and opens or updates a PR (`frontend/shipLayout.ts`). **Disabled while anything is unfinished** |
| Unfinished | amber list above the Ship row | `editor/configParity.ts` — the structural rules a layout must satisfy whoever authored it: every caption needs a tail and both morph targets, every link must resolve within its panel, every picture needs extent and a `/comic-book/` source |
| Reset all | clears working copy | Removes `localStorage['comic-book:editConfig']`, re-seeds from source |

`EditorOverlay.tsx` is dynamically `import()`-ed behind the DEV gate so Rollup
tree-shakes it (and `editor.css`) out of the production bundle. Only `layoutConfig.ts`
(data), `bubbleTypes.ts` (data) and `transforms.ts` (pure CSS/math) ship in prod. All
editor math, config editing and serialization is pure and unit-tested in
`frontend/src/tests/skins/` (`editorConfigOps`, `editorSerialize`, …). See
`frontend/src/skins/comic-book/editor/README.md` for the quick-start.
