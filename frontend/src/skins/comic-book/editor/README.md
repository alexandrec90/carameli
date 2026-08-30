# Comic-Book Visual Layout Editor (dev-only)

A small in-app editor for visually **placing, framing and resizing** the pictures and
speech bubbles in the `comic-book` skin, and for **reshaping the panels themselves**,
plus an **export** that copies the tuned numbers back into source.

It has two modes, switched at the top of the toolbar. **Content** places pictures and
bubbles; **Panel shapes** drags the lines between panels.

## Source of truth

[`layoutConfig.ts`](./layoutConfig.ts) holds `PANEL_IMG_TRANSFORMS` and
`PANEL_BUBBLE_TRANSFORMS` — picture placement **and content** (panel / src / alt /
left / top / width / height / scale / offsetX / offsetY / anchor / spill) and bubble
placement **and content** (panel / top / right / width / rotate / spill / type / tail /
content / text — lettering, a comma-delimited wheel picker, a text input, a phone
input formatted from the browser locale, or a dial, which is the wheel and the phone
input in one balloon), plus each bubble's event morph targets
(`hoverType`, `clickType`), whether the pointer also inks its outline heavier
(`hoverBold`) and its
linked partner (`linkTo`) and the SMS conversation that linkage makes it a column of (`chain`,
an editor-generated id resolved through `PANEL_BUBBLE_CHAINS` — see *Bubble chains*
below). It also holds
`PANEL_PATTERNS` — each panel's
Ben-Day background style, the one array here that **is** parallel to `PANELS` — and
`PANELS` itself, the list of slots (label, `isLogo`, page), which lives here rather
than in [`../panels.ts`](../panels.ts) because the editor appends to it when a panel
is split. The per-panel palette and dot metrics stay tuned in
[`../panelPatterns.ts`](../panelPatterns.ts) (`PANEL_BG_CONFIGS`, read through
`panelBgConfig`, which wraps for a panel past its end), so switching a panel's pattern
keeps its colors. A picture's `src` is a public URL, offered in the
editor by the static manifest in [`assets.ts`](./assets.ts) (`PANEL_ASSETS`). The
bubble `type` resolves to a lettering font via [`bubbleTypes.ts`](./bubbleTypes.ts)
(`BUBBLE_TYPES`); the outline itself is generated vector geometry in
[`../bubbleShape.ts`](../bubbleShape.ts). The renderer reads everything from these
modules — there are no more magic framing numbers, and no bubble text lives in
`Layout.tsx`.

[`layoutConfig.ts`](./layoutConfig.ts) also holds `PANEL_GRIDS` — a `PageGrids`
record: for each **page** (`classic` / `home`, chosen from the route by
`pageForPath`), one panel subdivision per window shape (`landscape` / `portrait` /
`square`, chosen by `layoutKindFor`). Every grid's ring table is `PANELS`-length: a
panel that lives on the *other* page keeps its slot as an **empty ring**, which
`gridPolys` hands back as a vertex-less polygon and `Layout.tsx` maps to `null`, so a
panel index means the same thing everywhere. A grid is a **shared-vertex planar
subdivision**: one table of
normalised `[x, y]` points and one ring of indices per panel. The two panels either
side of a line name the *same* indices for it, so moving a vertex moves both sides at
once and they cannot come apart. `../panelGeometry.ts` turns a grid into viewport
polygons; `panelGridOps.ts` holds the edits (move, bend, straighten) and
`panelGridValidate.ts` the structural guard a persisted grid has to pass.

**Neither transform array is parallel to the panels.** A picture and a bubble alike name their
own `panel`, so a panel may own several of each or none, and each array's length is the
author's. `panel` is the whole association: placement is measured against that panel's
box, and hovering that panel is what reveals its bubbles. A `linkTo` partner must sit on
the **same panel** — the editor only offers same-panel partners, and the renderer drops
any cross-panel link it is handed, because half a tube appearing on a different hover
cannot read as one utterance.

**A bubble chain is one SMS conversation, drawn as a table of two columns.** **Linkage is
what makes one.** Link two balloons together with the `link to` picker — the same field
that declares a connector tube — and tick **scrollable chain** on either: the rightmost of
the linked balloons becomes the **sender's** column and the leftmost the **recipient's**.

Those two balloons are **templates, not slots**. Neither is drawn where it sits outside
edit mode; each row of the conversation is *stamped* from the template of its side —
shape, tail, rotation and lettering — at a width that follows the message and a height
that follows the width. That is what lets the two columns interleave freely, so one party
can send two in a row:

```text
them:  Hey, are you around?
them:  I have that number for you
  me:  give me a sec
them:  555-0134
  me:  [composer]
```

Rows stack upward from the sender template's `top`, newest at the bottom. `rows` is how
many the table holds at once (default 6); past that the wheel moves the window rather than
the table growing, so ten messages through six rows is six on screen and a scroll to reach
the rest. There is no per-chain scroll toggle, because a chain *is* that window.

`messages` is the transcript, oldest first, and a line beginning `> ` is the **sender's** —
that marker is the only thing deciding which column a message lands in. Leave the box empty
and the conversation speaks the two templates' own `text`.

Give the *sender's* balloon `content: 'input'` or `phone` and the chain goes **live**: the
bottom-right row becomes a composer, Enter sends what is typed as the sender's next
message, and the table grows by one row per message until it is full. The composer costs
one row, so a six-row live chain is the field plus the five newest messages.

The chain's own settings live in a separate list keyed by an id (`PANEL_BUBBLE_CHAINS`):
how many `rows`, whether it `grow`s one at a time, how fast (`stepMs`), and the `messages`
themselves. Both the ids and the list are **derived**, not authored — `propagateChains`
settles one id per linked group and `syncChains` rebuilds the list from those ids, after
every op that touches a bubble. So the checkbox is the whole of "make a chain" and "unmake
one": there is no name to type, no add-chain operation and no delete-chain operation to get
out of step. A chained balloon draws no tube: `linkTo` says *which* balloons belong
together and `chain` says whether that means a welded pair or a conversation, since a tube
welds two fixed shapes while a template is a stamp for rows that do not exist yet. See
`../bubbleChain.ts` for the layout and window arithmetic and `chainOps.ts` for the list's
lifecycle.

**A picture has two independent framings, which is why it has so many fields.**
`left`/`top`/`width`/`height` are the *frame*: its own rectangle over the panel box, in
% of that box. It stays a rectangle — the **panel** is the window the picture is seen
through (`imgPanelClip` translates the panel's polygon into the frame's coordinates), so
a picture left at the default `0/0/100/100` crops exactly as a panel image always did,
and an inset one is a rectangle of picture rather than a small panel with the grid's
slant and a black border of its own. **A picture is never inked** — the selection outline
you drag is the artwork's real rect, and nothing else is drawn around it.
`scale`/`offsetX`/`offsetY`/`anchor` are the second framing: they move the picture
*inside* that frame. Before pictures became entities the frame was the panel polygon
itself, so dragging could only slide the picture under a window that stayed put, and a
second picture on the same panel had nowhere to go.

**A picture may also be a *surface*.** Switch **Project a table onto this image** on and
the picture carries a `table`: four draggable corners (`quad`, in % of the picture's
rendered rect — the artwork's pixels, so a window resize cannot slide the picture out
from under the surface), a row count, the columns, and the cell text. The corners are a projective map —
`tableProjection.ts` solves the homography taking the unit square onto them and emits it
as one `matrix3d` — so a table can be laid onto a notepad photographed at an angle and
converge with it, which three rotation sliders cannot do. The field is **absent**, not
null, on a picture that is not a surface; that absence is what "not a surface" is spelled
as everywhere the config is cloned, hydrated or serialized.

**A surface can show live records instead.** The **shows** select points it at a feed —
`table.source` is `'calls'` or `'sms'`, and absent when the author typed the cells — and
the rows then come from the database, refreshing on their own: a call placed or a message
sent appears on the notepad without the page being reloaded. The editor still owns the
placement (corners, bands, ink, widths, alignment, headings) and the feed owns the cells,
so **`data` stays empty in the config for a live surface**. That is deliberate and
enforced on the way in and the way out: the rows are call and message history, and saving
them would write real phone numbers into `layoutConfig.ts`. The **+ Column** and **−**
buttons disappear while a feed is on, because a feed's cells are positional and cutting a
column would slide every value one heading to the left. Nothing under `skins/` fetches:
`hooks/useLiveTables.ts` asks, `lib/liveTables.ts` maps a record to a row, and
`Layout.tsx` drops the rows in between the working copy and the panels.

The surface divides into `rows` equal bands, and the scroll offset is an **integer index
into the data**, never a pixel position: band *k* lands in exactly the same place at every
offset, which is what keeps the lettering on the ruling drawn in the picture. Rows outside
the window are not in the DOM at all, so there is no scroll container and therefore no
scrollbar to hide. Out of edit mode a reader sees only the values and scrolls with the
wheel; the guides, the dashed outline and the corner grips exist only while the editor is
open.

**Bubbles are drawn, not imported.** Every shape is one closed ring of the same 64
vertices sampled from a shared ellipse, so a shape change interpolates vertex-for-
vertex and reads as a morph. That is why there is no bubble artwork any more: two
different images can only crossfade. A new bubble type belongs in `bubbleShape.ts`'s
`SHAPES` table as another radial modulation, and must keep the shared ring count.

## Quick start

1. Run the dev server and open the app with `?edit=1` in the URL
   (e.g. `http://localhost:5173/?edit=1`). The flag persists in `localStorage`
   across client-side navigation; leave edit mode with `?edit=0` (which also
   clears the persisted flag). Toggle back and forth via the URL as needed —
   your unsaved working copy survives the round trip.
2. Pick a mode: **Content** (pictures and bubbles) or **Panel shapes** (the lines
   between panels). In shapes mode the content click targets are not rendered at all,
   because a panel-sized target would swallow every drag aimed at a line crossing it.
3. *(Content)* Click a **panel**, a **picture** or a **bubble** to select it. (In edit mode every
   bubble is shown without hover so it can be selected.) A picture wins the click over
   the panel under it, and a bubble over both. Selecting the panel itself is how you
   reach one that has nothing on it yet, and it is what **+ Image** / **+ Bubble** add
   to; a panel has nothing to drag, so it is only outlined. With a panel selected,
   the inspector offers its background **pattern** style — the palette stays the
   panel's own, so switching styles keeps its colors.
   - The overlay blocks the panels' own click navigation, so use the **Page**
     dropdown in the toolbar to move between pages (each switch replays the
     Ben-Day wash transition). The **Loading screen** entry previews the loading
     overlay; picking any page again replays its exit wash.
4. *(Content)* Adjust:
   - **Drag** the selection to move the frame (picture) / the bubble.
   - **Drag the bottom-right handle** to resize the frame (picture) / the bubble.
   - **Drag the round top-left handle** to pan the picture inside its frame (picture only).
     A picture is framed twice, so it needs two grips: the body moves the window, this
     one slides the picture behind it.
   - **Drag the round top-right handle** to rotate (bubble only).
   - **Wheel** over the selection to zoom the picture inside its frame / resize (bubble).
   - **Arrow keys** nudge (hold **⇧** for ×10); **+/-** zoom (picture) / resize (bubble);
     for a picture hold **Alt** to pan and size the *frame* instead; **Del** deletes;
     **Esc** deselects.
   - For pictures: pick the **panel** it belongs to, the **picture** it draws (from
     `PANEL_ASSETS`), and its **alt** text — empty marks it decorative — plus the
     **anchor**, which decides what survives when the picture's aspect ratio does not
     match the frame's.
   - **Project a table onto this image** (picture only) turns the picture into a
     surface. A starter table appears with its corners near the picture's own, plus:
     **Rows** (how many bands are visible at once — set it to the number of ruled lines
     you want to fill), **Text** (font size as a fraction of a band), **Ink** (a colour
     picker), a **Headings** checkbox, the four **corner** X/Y fields, and a **Columns**
     list where each column gets a heading, a width weight and an alignment. The cell
     text is one row per line, columns separated by a tab or a `|`.
     - **Drag the four square corner grips** onto the surface in the photograph — the
       band guides are drawn *through* the same projection, so once they sit on the
       ruled lines the rows do too. **Reset corners** puts them back.
     - **shows** picks what fills the bands: *Cells typed below*, **Call records** or
       **SMS messages**. A feed brings its own columns and takes the cell box away — the
       rows are live and refresh themselves. Going back to typed cells seeds a fresh
       starter table, because the feed's five empty columns would leave nothing to see.
     - Switching the checkbox off deletes the table, including the cells; the picture
       itself is untouched.
   - **Project a number pad on this picture** (picture only) adds the fixed telephone
     layout: 1–9 over the first three rows, then `*`, `0`, `#`. Drag its magenta corner
     grips or type the corner coordinates to align it with the photographed plane; the
     **Text** and **Ink** controls tune the symbols. Its 3 × 4 grid and outline are
     visible alignment guides in the editor only. Outside edit mode the twelve symbols
     are a **working telephone keypad**: each key is a button wired to the app's shared
     softphone. Inside edit mode the pad takes no pointer input at all,
     because the corner grips are on the same picture and would lose every drag to it.
     A picture carries either a table or a number pad, so switching either option on
     replaces the other projected content.
   - **Allow spill outside panel** checkbox — off (default for pictures) clips the
     element to the frame's polygon (overflow hidden behind its edge); on lets it
     bleed past (default for bubbles).
   - For bubbles: pick the **panel** it belongs to, a resting **type** (sets shape +
     lettering font), which way the **tail** points (**No tail** is one of the nine
     options), pick the **content** presentation (**Text**, **Wheel picker**, **Text
     input**, **Phone input**, **Dial**, or **Action buttons**). Wheel text is
     comma-delimited options: hover the bubble outside edit mode and scroll to turn it.
     Input text is its initial value; phone input formats live using the browser locale,
     while a leading `+` selects an international calling code. A **Phone input** balloon
     that is not in a chain is the projected pad's fallback: Enter places the call on the
     app's shared softphone, so a page whose art carries no keypad still has somewhere
     to dial from. In a chain that same content is the conversation's composer instead
     and dials nothing. **Action buttons** text is comma-delimited too: each entry is
     one button (`../BubbleActions.tsx`). Two labels name the telephone's own keys and
     draw as its artwork instead of lettering — `Call` and `End call`, matched on
     letters alone, so case and hyphens do not matter. Those two are wired to the
     shared softphone: green dials what the number pad typed and answers a ringing
     call, red hangs up and declines one, and each is disabled when the phone has
     nothing for it to do (`../phoneActions.ts`). Any other label is lettered and
     pressable and does nothing, which is also what both look like in the editor.
   - **Dial** is those two at once, for the balloon beside a photographed telephone: an
     autocomplete whose list is the wheel. Its text is the comma-delimited shortlist, and
     there is only ever **one** window — the drum's centre line is a real phone field
     rather than lettering, and the rows behind it are the shortlist as the typed number
     has narrowed it. Typing filters (on the digits, so `+1 234 567 9999` and a keypad
     punching `234…` find each other); turning the drum (scroll, or ↑/↓ with the field
     focused) walks the matches and letters each into the field; turning back up off the
     first match returns the reader's own half-typed number. It starts on the first option,
     and a number the shortlist does not carry simply empties the drum and stays in the
     field. **Dialling saves the number**: Enter appends it to that panel's options, so the
     drum becomes a redial list (`dialOptions` merges it in, ignoring punctuation, so a
     number the author already listed is not listed twice). **A number pad projected onto a picture in the
     same panel types into it**, so the phone in the photograph and the balloon are one
     number rather than two; that is why the value is held by `../ComicPanel.tsx`, the only
     component that can see both halves. Enter dials and, unlike a composer, keeps the
     number on the display. A dial also counts as the panel's picker for an SMS chain
     (`peerPickerOn`), which then binds to whatever the field says.
     Edit the **text** or **initial value**, choose the shapes to
     morph to **on hover**
     and **on click** (`— no change —` keeps the resting shape), tick **bolder outline
     on hover** to have the pointer ink this balloon heavier as well, and pick a **link
     to** partner to join with a connector tube. The bold is the one event response that
     is not a morph, because weight is a stroke rather than a shape; it takes the tail
     and a thought bubble's puffs with it — they are the same ring and the same class —
     and stops there: a connector tube keeps its own weight, so does the balloon at the
     far end of it, and so does every other row of a chain. Turning or removing a tail morphs
     like any other shape change, because the tail is one ring vertex pulled out.
     The tube redraws live as you drag either end; two bubbles that overlap draw no
     tube at all, so drag them apart if one doesn't appear. Links are symmetric —
     declare it at one end only — and the **link to** dropdown lists only the other
     bubbles on the same panel (it is disabled when there are none). Changing a
     bubble's panel clears a link that would have crossed one.
   - **+ SMS** (toolbar) is how a conversation is made, and the only way. It drops **two
     root bubbles** on the selected panel — the sender's on the right, the recipient's
     mirrored across from it — already linked, already one chain, already bound to the
     account's real thread, with the sender set to **Text input** so the bottom row is a
     composer. There is nothing to assemble and no order to get right: that used to be six
     separate edits, any one of which could be undone by accident and leave balloons that
     looked finished and drew nothing.
     - **Position the two root bubbles** by dragging them: each is the template every row
       on its side is stamped from — its shape, tail, rotation and lettering — and its
       placement is where that column sits. Drag one past the other to swap the columns.
     - **Stretch the table** the same way: resize a template to widen its column, and set
       **rows** in the conversation section for how far up the panel the thread reaches.
       The **dashed violet frame** on the panel is where those rows will actually land, so
       every one of these edits has a visible result in edit mode.
     - **+ Number picker** appears in the conversation section when the panel has no
       picker balloon. Which number a bound conversation is with is not stored on the
       chain — it is whatever the panel's first non-chained `wheel`/`dial` balloon is
       showing (`peerPickerOn`) — so without one the thread renders empty.
     - **+ Other column** appears while a chain has only one balloon and adds its partner
       mirrored across the panel, tail flipped, linked back to it.
     - A chain that is *not* bound keeps its **messages** box — one per line, oldest
       first, a leading `>` marking the sender's side, an empty box meaning the two drawn
       balloons' own text is the transcript. A bound one does not: its balloons are real
       messages, so an authored transcript there is a field you could type into and never
       see again.
     - In edit mode the two templates render flat, all-visible and at their own
       placements, so you are always dragging the columns themselves rather than chasing a
       row an animation put somewhere. Nothing binds and nothing sends while the editor is
       open.
   - **+ Image** / **+ Bubble** / **+ SMS** (toolbar) append a new picture, bubble or
     conversation to the selected panel — select the panel, a picture on it or a bubble on
     it first, so there is a panel to add to — and select what they added. **Delete image** /
     **Delete bubble** (inspector) removes the selected one; deleting a bubble also
     clears any link that named it. **Reset** restores a shipped element to its
     default; one you added has no default, so reset leaves it alone.
   - The toolbar is **draggable by its COMIC EDITOR title bar** — move it off any
     panel it covers. The position is clamped to the viewport and persists in
     `localStorage` across reloads.
5. *(Panel shapes)* Every line between two panels is drawn as a blue handle:
   - **Drag a line** to slide the whole of it; **drag a vertex** to move one end.
   - A vertex **on the frame** slides along its own edge and no further, and the four
     frame corners do not move at all. There is no handle on the frame itself: a frame
     edge belongs to one panel only, so it is never a line between two, and the
     gesture that would move it does not exist.
   - **Double-click a line** to put a bend in it (or select the line and press **Add a
     corner to this line**), then drag the bend — repeat for the lightning-bolt shapes.
     **Delete** (or **Straighten** in the inspector) takes a bend back out; a vertex
     where three lines meet, or one on the frame, is not a bend and is refused.
   - **Drop a vertex onto another vertex** to merge the two into one junction. Within
     snap range the target lights up and the dragged vertex sits exactly on it; no snap
     is offered when the merged grid would be invalid, or when the two obey different
     frame constraints. This is the only way two corners can occupy one point — released
     just short of each other they would be two coincident vertices joined by a
     zero-length seam, which the validator rejects, so the snap merges them instead.
   - **Alt-drag a vertex** to tear a junction apart — the inverse of the merge. The
     seams on the drag side of the corner follow the pointer, the rest stay put, and
     the two corners are left joined by a new edge; which seams come along is re-read
     from the live drag direction, so circling the pointer changes what tears off.
     Near the continuation line of a neighbouring seam the torn corner snaps exactly
     onto it, which is how a collapsed cross folds back into two junctions sitting on
     one straight seam. While the torn grid would be invalid nothing tears — the grid
     stays whole, so dropping the corner back where it started simply cancels.
   - A plain-dragged vertex snaps onto those **continuation lines** too (only past a
     seam's end — on its body the result would be a T-junction), so a corner can be
     placed exactly in line with a seam it does not join.
   - **Click a panel, then Split top / bottom or Split left / right** to make a new
     panel: a straight cut through the middle of the panel's box, on all three window
     shapes of its page at once. The upper or left half keeps the panel's name,
     pattern, pictures and bubbles; the other half is appended to `PANELS` as a new
     panel with a numbered copy of the name (`Mechanic` → `Mechanic 2`) and the same
     pattern, and is selected. The new line is an ordinary seam — drag it, bend it,
     merge its corners. What was on screen holds its place, so a picture that filled
     the parent now hangs over the cut; move it onto whichever half it belongs to, or
     re-assign it in the inspector. The cut is refused whole, with a note in the
     inspector, when any of the three grids cannot take it — a panel whose outline
     bends back across its own middle; straighten it first. A panel made this way has
     no shipped shape, so **Reset shapes** leaves it with an empty ring on that window
     shape until it is split off again; and there is no delete — merge its seams away
     and it keeps its slot.
   - Rename a panel from the **name** field of its inspector, in either mode.
   - **Arrow keys** nudge the selected vertex (hold **⇧** for x10); **Esc** deselects.
   - The gutter between panels stays the same width at every angle — it is measured
     perpendicular to each edge, not per axis — and every panel stays inside the outer
     frame. Neither is a rule applied afterwards; both fall out of the geometry.
   - **Reset shapes** in the inspector restores the current window shape's grid, for
     the current page. Each page's three grids are edited independently: resize the
     window to reach another shape, switch pages to reach the other page's grids.
   - **Content holds its place** through every shape edit, reset included: a panel is
     only the window its pictures and balloons are seen through, so each affected
     frame and each affected balloon is re-expressed against its new panel box
     (`gridContentRemap.ts`) and the polygon clip alone follows the seam. A chain
     needs nothing of its own — it is laid out from the balloons that are its slots.
6. Click **Save** to write the change straight back to `layoutConfig.ts` (a dev-only
   Vite endpoint, `POST /__comic-editor/save`); HMR reloads it. **Reset** discards
   unsaved edits and reverts to the last saved file.
7. Reload **without** `?edit=1` — your saved change is now the baseline.
8. Click **Ship** when the layout is worth keeping: it saves, then commits, pushes and
   opens or updates a pull request. The status line under the button carries the branch
   and a link to the PR.

**Copy config** / **.ts** remain as fallbacks: Copy puts the paste-ready
`export const` blocks on the clipboard; **.ts** downloads a complete `layoutConfig.ts`.
Both are used automatically if the Save endpoint or clipboard is unavailable.

## Save writes a file; Ship makes it survive

Save writes into whichever working tree the dev server is serving, and **two of the
three trees that run this editor hold that file somewhere git is not watching**:

| Where the dev server runs | HEAD | What Save alone leaves you with |
| --- | --- | --- |
| An ephemeral box, `.worktrees/<project>--<slug>` | an `agent/…` branch | an uncommitted change on a real branch |
| A UI preview copy, `.ui-previews/<project>/<ref>` | **detached** | a change git will not let you commit |
| The static checkout | the default branch | a change the branch policy protects against |

The middle row is the dangerous one. `preview-ui-host.py --clean` removes those copies
with `git worktree remove --force`, so a layout saved into one lives in exactly one
place that routine cleanup deletes — which is how an afternoon of panel work came to be
recovered from a browser download and a dirty preview copy on 2026-08-26.

**Ship** is the answer to that, and it is deliberately one button rather than a
checklist. `POST /__comic-editor/ship` writes the file and then hands it to
[`frontend/shipLayout.ts`](../../../../shipLayout.ts), which:

1. cuts an `agent/<slug>-<MMDD>` branch when HEAD is detached or on the default branch,
   and otherwise **reuses the branch you are on** — so a second Ship updates one PR
   instead of opening a second beside it;
2. stages `layoutConfig.ts` **only**, never the rest of a working tree;
3. commits, then pushes, then asks `gh` for the branch's PR and creates one if there is
   none.

The push happens before the PR call on purpose: a machine with no working `gh` still
ends with the work on the remote, and the status line says so. Nothing is silent — a
blocked commit or a rejected push comes back verbatim in that line, with a reminder that
**.ts** still downloads a copy.

The summary box is optional. What you type becomes both the branch slug and the commit
subject; empty falls back to a generic one.

## Dev-only / zero prod cost

The editor is gated behind `import.meta.env.DEV && (?edit=1 OR localStorage flag)`.
`EditorOverlay.tsx` is pulled in via dynamic `import()` behind an
`import.meta.env.DEV` check, so Rollup tree-shakes it (and `editor.css`) out of the
production bundle. Only `layoutConfig.ts` (data), `bubbleTypes.ts` (data), and
`transforms.ts` (pure CSS/math the renderer needs) ship in prod — all tiny. The Save
and Ship endpoints live only in the dev server (Vite `apply: 'serve'`), so nothing that
writes a file or spawns a process is reachable from a built bundle. `?edit=1` does
nothing in a prod build.

## Layout

```text
types.ts            ImgTransform, BubbleTransform, BubbleChain, EditorConfig
assets.ts           PANEL_ASSETS: the pictures a frame may point at (static manifest)
bubbleTypes.ts      BubbleType + BUBBLE_TYPES (lettering font per type) — ships in prod
../panels.ts        Panel, PANEL_PAGES, pageForPath: the slot type and the route → page rule
layoutConfig.ts     PANELS (the slots `panel` indexes — label, isLogo, page) beside the framing data
serializePanels.ts  the PANELS block of layoutConfig.ts, prose and all
configPanels.ts     PURE: split a panel — list, patterns and all six grids together — and rename one
panelGridCut.ts     PURE: cut one ring in two along a straight line, inserting the crossings
../PanelImages.tsx  one panel's pictures: filters the array by panel, frames and clips each
../bubbleBox.ts     PURE authoring box: viewBox, base ellipse, TAIL_DIRS + tail geometry
../bubbleShape.ts   PURE outline geometry: the shared vertex ring, per-type modulation, morph lerp
../bubbleTube.ts    PURE connector-tube geometry + link/reveal semantics
../bubbleChain.ts   PURE chain arithmetic: columns, row layout, transcript, head clamp, window
../useBubbleMorph.ts  rAF morph driver — writes `d` to the DOM, not through React
../PanelBubble.tsx  one bubble: outline SVG + content + hover/press morph state
../BubbleInput.tsx  real text/phone input; isolates its events from panel navigation
../BubbleDial.tsx   the 'dial' kind: an autocomplete drawn as a drum, field on its centre line
../dialPicker.ts    PURE dial arithmetic: filter, which row, keypad-key append, redial list
../usePhoneField.ts caret-preserving phone editing, shared by BubbleInput and BubbleDial
../phoneInput.ts    PURE locale detection, live phone formatting + caret/deletion math
../bubbleContent.ts content-kind registry, persisted-value guard, the panel's dial balloon
../PanelBubbles.tsx one panel's bubbles: filters the array by panel, clips the non-spilling ones
../PanelBubbleChain.tsx  one conversation: rows from templates, growth timer, wheel scroll, composer
../BubbleTubes.tsx  viewport-level tube layer for every linked pair
../tableProjection.ts PURE: the corner quad -> homography -> `matrix3d`, and the layout box
../tableData.ts     PURE: rows visible at an offset, wheel-to-rows, column widths, cell text
../ProjectedTable.tsx one picture's surface: the projected table, its wheel and its keys
../table.css        surface + cell styles, and the editor-only band guides
../useLiveTableImages.ts hook + PURE: which feeds a page needs, and the rows dropped onto its surfaces
../../../lib/liveTables.ts PURE: the feeds, their columns, and record -> row (shared, no fetching)
../../../hooks/useLiveTables.ts hook: the only place a surface's rows are fetched, and the poll
../ProjectedNumberPad.tsx fixed 3 × 4 telephone keys on a projected surface; live buttons outside edit mode
../number-pad.css   number-pad lettering, surface layout, and the live key's press states
../BubbleActions.tsx action buttons inside a balloon, one per comma-delimited entry
../phoneActions.ts  PURE: label -> the telephone key it draws, and the softphone verb it runs
../panelGeometry.ts PURE grid -> polygon geometry: frame, normalised space, vertex constraints
../panelPatterns.ts pattern style registry + per-panel palette/dot tuning (PANEL_BG_CONFIGS)
../polygonInset.ts  PURE polygon maths: the perpendicular gutter inset, bounding box
panelGridOps.ts     PURE grid edits: move vertex, insert/remove bend, seam listing
panelGridMerge.ts   PURE merge: collapse two vertices into one junction, and the snap target
panelGridSplit.ts   PURE tear: pull one junction apart into two, and the seam-line snap
panelGridValidate.ts PURE structural guard: rings, ranges, no T-junctions
layoutConfig.ts     PANEL_IMG_TRANSFORMS, PANEL_BUBBLE_TRANSFORMS, PANEL_PATTERNS, PANEL_GRIDS — source of truth
configOps.ts        PURE config edits: re-exports configSeed + configHydrate, patch/add/remove, links
configSeed.ts       PURE: the working copy's seed, clone, and per-breakpoint grid set/reset
gridContentRemap.ts PURE: grid set/reset with every picture and balloon held still on screen
configHydrate.ts    PURE: parse a persisted payload back into a config, falling back per field
chainOps.ts         PURE chain-list lifecycle: linked groups -> ids, derive the list, patch, clamp, hydrate
reconcile.ts        PURE: settle links, ids and the chain list after any bubble-touching edit
chainCreate.ts      PURE: + SMS (two bound root bubbles, whole) and + Number picker
chainFrame.ts       PURE: where a conversation's rows land, as the editor's dashed frame
useSeamDrag.ts      hook: which gesture a pointer means, and the grid edit it maps to
PanelSeams.tsx      the draggable line + vertex handles (shapes mode)
ShapeInspector.tsx  shapes-mode inspector: vertex read-out, add corner, straighten, reset grid
tableValidate.ts    PURE: a new table, and the repair of one read back out of a payload
numberPadValidate.ts PURE: a new number pad, repair, and deep clone
serializeTable.ts   PURE: a table as the nested block on a picture's line
serializeNumberPad.ts PURE: a number pad as the nested block on a picture's line
tsLiteral.ts        PURE: quoting and number rounding shared by the two serializers
useTableCornerDrag.ts hook: dragging a corner grip, and the clamped single-corner edit
TableCorners.tsx    the four corner grips shared by both projected content types
TableInspector.tsx  table controls: the on/off switch, the live-feed select, rows, text, ink, headings, corners
NumberPadInspector.tsx number-pad on/off, text, ink, and corner controls
TableColumnsInspector.tsx  the columns list, and the cell-text box an authored surface has
editor-table.css    corner grip and table-inspector styles
serialize.ts        PURE serialization back to layoutConfig.ts (headers included)
transforms.ts       PURE helpers: CSS builders, frame/drag/scale math, clamp
useEditorMode.ts    hook: flag detection, working copy, persistence, selection
useOverlayInteraction.ts  pointer/wheel/keyboard wiring (thin)
useToolbarDrag.ts   hook: draggable toolbar position (viewport-clamped, persisted)
EditorOverlay.tsx   overlay UI: click targets, outlines, chain frames, seams (dev-only, dynamically imported)
EditorToolbar.tsx   toolbar chrome: mode toggle, page select, inspector slot, save/reset/export
InspectorPanel.tsx  selection inspector: read-outs, spill, per-element reset, delete
ImageInspector.tsx  picture-only controls: panel, picture, alt, anchor
BubbleInspector.tsx bubble-only controls: panel, type, tail, content, text, hover/click, link
ChainInspector.tsx  the chain half of that inspector: rows, an unbound chain's messages, + column, + picker
PageSelect.tsx      toolbar dropdown: switch page / preview the loading screen
pageSelection.ts    PURE helpers behind PageSelect (sentinel value, selection resolution)
../bubbleChains.css chain row placement + the arrival/scroll animations (ships in prod)
editor.css          overlay chrome styles
editor-shapes.css   seam and vertex handle styles
```

Save overwrites `layoutConfig.ts` **verbatim** with what `serialize.ts` emits, so
anything that module does not write is deleted on the first save. That is why the
file's explanatory comments live in `serialize.ts` as headers, and why nothing else
(a `NEW_IMAGE` or `NEW_BUBBLE` default, a helper) may live in `layoutConfig.ts`.
`editorSerialize` asserts the round trip byte for byte, so a header edited in one file
and not the other fails there rather than on the first save.

All math/serialization is pure and unit-tested under
`frontend/src/tests/skins/` (`comicBookTransforms`, `editorTransformsMath`,
`editorMode`, `editorConfigOps`, `editorChainConfig`, `editorChainOps`,
`editorSerialize`, `pageSelection`, `editorToolbarDrag`, `bubbleShape`, `bubbleTube`,
`bubbleChain`, `panelGeometry`, `panelGridOps`, `gridContentRemap`, `panelLayouts`, `tableProjection`,
`tableData`, `tableConfig`, `ProjectedTable`, `liveTableImages`,
`TableSourceInspector`) — and the live feed itself in `frontend/src/tests/lib/liveTables`
and `frontend/src/tests/useLiveTables`.
