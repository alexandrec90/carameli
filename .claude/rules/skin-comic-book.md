---
description: Comic Book skin (Lichtenstein pop-art) — palette, panel grid, bubbles, chains, motion, framing, and the dev-only editor
paths:
  - frontend/src/skins/comic-book/**/*.ts
  - frontend/src/skins/comic-book/**/*.tsx
  - frontend/src/skins/comic-book/**/*.css
  - frontend/src/hooks/useSmsConversations.ts
  - frontend/src/hooks/useLiveTables.ts
  - frontend/src/lib/smsConversation.ts
  - frontend/src/lib/liveTables.ts
---

# Rule: Comic Book Skin — "POW!"

Skin-system architecture is `.claude/rules/skin-architecture.md`; the editor quick-start
is `frontend/src/skins/comic-book/editor/README.md`.

## Stack

React DOM + Canvas 2D (Ben-Day dots, panel ink, wash overlay); CSS `@keyframes` and rAF
loops, no spring libraries; `Bangers` (display) and `Comic Neue` (body) from Google Fonts
in `index.html`. Art is `.webp` under `public/comic-book/`, grayscale at rest and
colorized on hover. PNG masters live in `frontend/assets-src/comic-book/`, **outside the
served tree** — Vite copies `public/` into `dist/` verbatim, so masters beside the WebPs
shipped ~24 MB no page requested.

## Palette

| Token | Hex | Role |
| --- | --- | --- |
| `--cb-yellow` | `#FFE033` | accent / Dashboard |
| `--cb-blue` | `#0057B8` | accent / Phone Lines |
| `--cb-red` | `#E8003D` | accent / Extensions |
| `--cb-green` | `#00A651` | accent / success |
| `--cb-cyan` | `#00AEEF` | accent / any other route |
| `--cb-magenta` | `#EC008C` | accent / highlight |
| `--cb-black` / `--cb-white` | `#111111` / `#FAFAF2` | ink and text / page and balloon fill |
| `--cb-dot-alpha` / `--cb-dot-hover-alpha` | `0.18` / `0.35` | dot opacity |

Each route gets **one** accent; the viewport dot background shifts to it.

## Layout — a comic page of panels

`<Layout>` draws a full-viewport canvas (dot raster in the page accent, plus panel ink);
views tile absolutely-positioned content over it. Nav is a caption box pinned top-left.

`PANEL_GRIDS` (`editor/layoutConfig.ts`) is one **shared-vertex planar subdivision** per
window shape (`landscape`/`portrait`/`square`, via `layoutKindFor`): normalised vertices
plus one ring of indices per panel, index-parallel to `PANELS`. `panelGeometry.ts` insets
the viewport by `OUTER_M` for the frame, then each ring by `HALF_GUTTER` **perpendicular
to every edge** (`polygonInset.ts`) — a per-axis inset narrows by the cosine of the angle,
so diagonals read as thinner lines.

- **The frame is not editable** — its edges belong to one ring each, so they are never a
  line *between* panels and get no handle.
- **Panels cannot come apart** — rings either side of a line name the same vertex indices,
  so one move moves both; nothing copies the change across.
- **No T-junctions** — `panelGridValidate.ts` rejects them, and a failing persisted grid
  falls back to the shipped one rather than rendering torn.
- **Two pages, one panel list.** `/` is the 4-panel home page, everything else the classic
  8-panel grid (`pageForPath` in `panels.ts`). Every grid's ring table is `PANELS`-length;
  an off-page panel keeps its slot as an empty ring, which `gridPolys` returns vertex-less
  and `Layout.tsx` maps to `null`. Index panels and polygons alike, and guard the nulls.

## Component patterns

| Component | Spec |
| --- | --- |
| `.cb-button` | 3 px black border; `Bangers` 20 px, tracking 2 px; accent background; box-shadow `3px 3px 0` → `5px 5px` hover → `1px 1px` + translate `(2px,2px)` press. No border-radius |
| Card / panel content | absolute inside a drawn panel region; 3 px `#111111` border; `--cb-white` fill; optional 8 px accent top-bar; drop-shadow `4px 4px 0 #111111`, no blur |
| `.cb-bubble` (inline status) | white fill, 3 px border, `clip-path` ellipse or spiky `shout`, tail down-left. A **different component** from the panel bubbles below: CSS-shaped, never morphs, cannot be linked |
| `.cb-asset` | rest `grayscale(1) contrast(1.1)`; hover `sepia(1) saturate(4) hue-rotate(var(--cb-hue-deg, 0deg))`, transitioned 200 ms ease-out |

Typography: `Bangers` uppercase for titles (28–48 px), headings (22–28 px), captions
(14 px) and status bubbles (18 px); `Comic Neue` 700 sentence-case for body at 14–16 px.

## Panel speech bubbles — generated, not drawn

SVG outlines from `bubbleShape.ts` (authoring box in `bubbleBox.ts`), rendered by
`PanelBubbles.tsx` / `PanelBubble.tsx`. Deliberately plain: thick black outline, flat
white fill, no texture, no gradient, no dots inside. Every type is one closed ring of the
same **64 vertices** off a shared ellipse, differing only by a radial modulation — which
is what lets any shape interpolate vertex-for-vertex into any other, so hover and click
**morph** rather than crossfade.

| Type | Outline | Reads as |
| --- | --- | --- |
| `soft` | the bare ellipse | speech |
| `cloud` | union of 8 lobes, junctions cutting *inside* the base ellipse | thought — outward-only bulges read as a scalloped balloon |
| `lightning` | 15 traced spikes (`boltShape.ts`) | impact; valley → straight climb → straight fall, so every turn is a corner |

- **`lightning`'s spikes are a table, not a formula**, traced from
  `assets-src/comic-book/jagged bubble.png`: any radial function of the angle spaces
  spikes evenly at one broad length and reads as a *sun*. Retune by re-tracing, keeping
  the spans summing to the ring.
- **An edge is a chord, not a radius ramp** — a non-corner vertex takes the radius where
  its ray crosses the line between its neighbouring corners; ramping the radius across the
  ring bows every edge into an arc (`boltShape.test.ts`).
- **`boltMod` clamps each vertex against the viewBox at its own angle**, so flank spikes
  come out shorter without the table encoding the box by hand.
- **`.cb-bubble-shape` needs `miter` and a raised `stroke-miterlimit`** — a round join and
  the default limit both take the point off an acute spike.
- **A new type is a `SHAPES` entry, not artwork** (images only crossfade), **never a
  different vertex count** (that silently breaks every morph through it), and
  `bubbleTypes.ts` gets **no `src` field**.
- **The `<path>` carries no `d` prop** — the morph writes `d` from a rAF loop
  (`useBubbleMorph.ts`), and a React-rendered one snaps the shape mid-morph.
- **The tail is one ring vertex pulled outward** (`TAIL_DIRS`: eight compass directions
  plus `'none'`), so a turn or a removal is an ordinary morph, not a second shape system.
  Its ink leaves the viewBox on purpose (`.cb-panel-bubble-svg` sets `overflow: visible`);
  padding the box would rescale every bubble already placed.

### A bubble — and a picture — belongs to a panel

Neither transform array is index-parallel to the panels: each entry names its own `panel`,
and that is the whole association — placement is measured against that panel's box, and
hovering it reveals its bubbles (`isBubbleRevealed` in `bubbleTube.ts`). `PANELS` is the
one surviving parallelism, and the editor only *appends* to it, so an index never moves.
A picture has **two independent framings**: `left`/`top`/`width`/`height` frame it over
the panel box (% of that box), while `scale`/`offsetX`/`offsetY`/`anchor` move it within
that frame.

**A picture is not a panel.** The frame is a plain rectangle; the panel is the *window*,
its own polygon translated into frame coordinates (`imgPanelClip`), so the picture keeps
its square edges and is cut only where the ink runs. Scaling that polygon *into* the frame
instead gives an inset picture the grid's slanted gutters. Pictures get no ink —
`PanelInk` takes `polys` and nothing else — and a second stroked border would contradict
the editor's selection outline, which traces `imgVisibleRect`.

### Connector tubes

A thin white corridor joins linked bubbles (`bubbleTube.ts`, `BubbleTubes.tsx`) — one
speaker continuing across two balloons; `linkTo` declares it symmetrically, one end is
enough. **Both ends must sit on the same panel**: `linkCandidates` never offers a
cross-panel partner, `linkedPairs` drops one it is handed, and `sanitizeLinks` runs after
every edit that can orphan a link. The corridor is **welded by paint order, not a path
union** — z-index 9, above a lifted balloon (8) and below the wash (10), so its white fill
erases the outline it covers. Overlapping bubbles draw no tube.

## Bubble chains — two balloons read as an SMS thread

A `chain` id joins a bubble to a conversation drawn as **two columns** (`bubbleChain.ts`,
`PanelBubbleChain.tsx`): recipient down the left, sender down the right, rows in send
order, so one party saying two things takes two rows.

**The members are templates, not slots.** The author draws one balloon per column — shape,
tail, rotation, lettering, the column's edge — and every row is stamped from its side's
template. Member 0 is the **sender**: rightmost, composer at its foot. Rows lay out
bottom-up, each `top` the running sum of the heights below it, so a long message pushes
the thread up by its own height instead of a fixed pitch it would overlap; width follows
the message (`messageWidth`). `PANEL_BUBBLE_CHAINS` holds one entry per id in use and is
**derived, not authored** (`syncChains`), so a chain with no members and a member with no
chain are unreachable rather than states to validate.

| Field | Effect |
| --- | --- |
| `grow` | plays the transcript a message at a time, `stepMs` apart. Render-time; **not an editor control** |
| `rows` | how many rows are on screen at once, counting the composer's |
| `messages` | oldest first; a leading `> ` marks the sender's side. **Empty = speak the two balloons' own `text`** |
| `sms` | binds to real SMS history — see below |

A chain *is* a window over a transcript, so the wheel always moves it and **the window
keeps its size while it moves** — twenty messages through six rows is six on screen at
every scroll position, never thinning toward the top (`stepHead`'s `floor`; the head stops
at `growTarget`). **Live** is `content: 'input'` (or `'phone'`) on the sender template:
the composer takes the bottom row and messages start one row up. The arithmetic is pure
and lives in `bubbleChain.ts`; `PanelBubbleChain.tsx` adds only the growth timer, wheel
listener, measured aspect and typed text.

- **A conversation is made whole or not at all.** `addSmsConversation` (the editor's
  **+ SMS**) establishes both balloons, their linkage, the chain id, the composer content
  and `sms: true` in one op, and is the *only* way to make one: the couplings all have to
  hold and none announce themselves when broken. Hence `grow`/`stepMs` have no control.
- **A chained balloon takes no tube** — a row holds whatever message the transcript put
  there, so a tube would join a different sentence each turn of the wheel. Same
  three-place enforcement as the same-panel rule.
- **A chain is one panel's** — `chainMembers` filters on panel as well as id.
- **Only up.** The window arithmetic assumes time runs upward; a horizontal chain needs a
  second axis in every one of those functions, not a CSS change.
- **Keys are message indices, not row indices** — a message keeps its DOM node as it moves
  up the table, which is what lets CSS transition its position instead of flickering text
  through stationary balloons. Arrival is a `@keyframes` animation (`bubbleChains.css`),
  not a transition: a node mounting with `is-visible` has no previous value.

### A chain bound to real SMS

`sms: true` stops a chain being a drawing: the transcript comes from the carrier, Enter in
the composer **sends for real**, and the account is billed. There is no safe mode.

**Which conversation is not stored on the chain.** It is whichever number the panel's
picker balloon carries: `peerPickerOn` takes the first `content: 'wheel'` **or** `'dial'`
balloon on the panel **that is not itself in a chain** — a picker inside a conversation is
choosing what to *say*, not who to say it to. A `dial` contributes its field rather than
the row it is parked on. Options resolve through `toE164` (`phoneInput.ts`), so one number
written three ways is one thread and a name binds nothing.

The skin never fetches: `App.tsx` owns `useSmsConversations()` and passes it as
`LayoutProps.sms`, and `PanelBubbles` calls `subscribe(peer)`. The hook polls
(`SMS_POLL_MS`) only while somebody is subscribed and shares one request between
subscribers, so a page binding nothing costs nothing — which is what lets `App` mount it
for every skin. It is a Layout prop rather than a view's hook result because skin chrome
has no view, and only the skin knows which number the reader picked. A sent message draws
optimistically as `is-sending` and retires when its row returns; a refusal is `is-failed`.

Rule 20's two prohibitions are asserted in
`src/tests/skins/PanelBubblesSms.test.tsx`: a bound chain that resolved no number shows an
empty conversation rather than the authored one, and edit mode binds nothing at all.

## Motion

**A panel is repainted only while it is active** — hovered, which is also when its picture
colorizes. One rAF loop drives every dot canvas (`usePanelDots.ts`), but **each panel owns
the clock, and the clock is what stops** (`panelDotAnim.ts`): off a shared wall clock the
pattern jumps forward by however long the pointer was away, so every return lands as a cut
instead of a resume. Panels are seeded from their shipped `phase`, so a page at rest is
not eight copies of one frame, and an inactive panel is repainted only when its canvas
goes blank (resize, remount, editor pattern switch) — then at the clock it froze on.

**Every style moves through the same `travellingWave` term** (`patternWave.ts`) rather
than its own drift, which is what keeps eight patterns reading as one page: dots swell and
ink up as a crest arrives, then shrink and fade behind it. Two rates and a spin are the
whole vocabulary — `WAVE_RATE` (expanding from a point), `SWEEP_RATE` (half of it,
crossing in a straight line), `SPIN_RATE` (a ray fan) — and all are far slower than the
3-second radius breathe. A slow drift of the *whole field* is the shape to avoid: slow
enough to read as calm is slow enough to look static, and fast enough to see is the
picture sliding. Renderers split by what moves: `patternDrawFields.ts` drifts the field
dots are sized from, `patternDrawRadial.ts` turns a focal pattern (`sunburst` one
revolution in ~6 min; `corner-burst` is the same wheel seen from a corner and covers the
**whole circle**, since a fan spanning only the visible quarter swings off the panel when
rotated and so rocked about a fixed axis instead). That shared ±0.35 px radius breathe is
why `panelPatternMotion.test.ts` leaves radius out of the frame signature — a style that
only breathed would otherwise pass a test for animating.

### Page transition — the Ben-Day wash

All math and drawing live in `benDayWash.ts`; `Layout.tsx` watches React Router `location`
and drives a rAF loop on one full-viewport canvas (`.cb-wash-canvas`, blank when idle). A
halftone wave travels the `x + y` diagonal from the top-left corner: **cover** (420 ms,
paper dots grow inside the band until they merge opaque) → **hold** (120 ms, the sheet
carrying the loading screen's ripple tinted with the incoming accent) → **reveal**
(420 ms, the same wave passes on and dots shrink behind it). The loading overlay uses the
same module — `drawLoadingRipple` for its background, exiting through the reveal phase
(`drawWash` with cover pinned at 1).

| Property | Value |
| --- | --- |
| Grid spacing | `20 px`, shared with the loading ripple so the surfaces align |
| Wave band depth | `220 px` |
| Merge radius | `spacing × 0.75` (≥ the `S·√2/2` tiling bound) |
| Ripple wavelength / speed | `260 px` / `0.55 cycles·s⁻¹`, identical for wash and loading |
| Easing | ease-in-out cubic per phase (`washPhaseAt`) |

### Panel ink

Each panel is stroked as one closed `<polygon>` on a viewport-level SVG above the pictures
(`#111111`, width 5, `miter`), so ink follows whatever shape the grid gives it. There is
no separate line layer: a separator is the two panels' own borders either side of the
gutter. Dot canvases are clipped to the same polygon.

## Framing: `layoutConfig.ts` is the source of truth

`editor/layoutConfig.ts` holds the panel shapes (`PANEL_GRIDS`), pictures
(`PANEL_IMG_TRANSFORMS`, `src` drawn from `PANEL_ASSETS` in `editor/assets.ts`), bubbles
(`PANEL_BUBBLE_TRANSFORMS`), the chain settings their ids resolve to
(`PANEL_BUBBLE_CHAINS`) and each panel's pattern style (`PANEL_PATTERNS`, the one array
parallel to `PANELS`); per-panel palette and dot metrics stay in `PANEL_BG_CONFIGS`
(`panelPatterns.ts`), read via `panelBgConfig` so a panel past the palette's end wraps
round. `hoverBold` on a bubble is the balloon's own only — its tail and puffs bold with
it, a tube and the balloon at its far end do not.

`Layout.tsx` reads from these arrays: there are **no magic framing numbers** in it or the
CSS, and no bubble text. Retune through the editor, not by hand.

**Save overwrites `layoutConfig.ts` verbatim** with what `serialize.ts` emits, so anything
that module does not write is deleted on the first save — hence the file's comments being
emitted as headers, and no default, helper or `NEW_IMAGE` living there. Config edits live
in `configOps.ts` (React-free; re-exports `configSeed.ts` and `configHydrate.ts`), grid
edits in `panelGridOps.ts`, the chain list's lifecycle in `chainOps.ts`; `reconcile.ts`
settles links, ids and lists after any bubble-touching edit, `chainCreate.ts` builds a
whole conversation, `chainFrame.ts` is the editor-only geometry of where its rows land.
Two hazards follow from Save writing the served tree directly, and both have cost sessions
a diagnosis by reading as a fault in the checked-out branch:

- **A `layoutConfig.ts` you did not edit is somebody's unsaved design.** A tab left open
  mid-design plants half-built balloons in whatever worktree ran the dev server. Answer:
  `git stash push -- <that file>` — never fill in the missing tails by hand.
- **A tab *behind* the file overwrites it.** The working copy lives in `localStorage` and
  outlives every merge, checkout and pull, so a tab opened before a change writes the
  pre-change layout back on its next Save, indistinguishably from the change having been
  reverted. `editor/configStamp.ts` fingerprints the config the payload hydrated from, so
  a mismatch with the bundle's means the file moved underneath: the editor says so in red
  and makes Save ask once. A payload from before stamps existed carries none and is
  **not** warned about — a warning on every one would be dismissed on the day it was right.

`bubbleRect` (`transforms.ts`) gives the bubble box's on-screen geometry to **both** the
renderer (aiming tubes) and the editor (hit target, selection outline). Keep it shared:
when they disagreed, the bubble you could click was not the one a tube pointed at.

## A picture can be a projected table surface

Any picture may carry an optional `table` drawing an HTML table onto the surface it
depicts — a notepad, a whiteboard, a screen. The field is **absent** on a picture that is
not a surface (in `configSeed.ts`, `configHydrate.ts` and `serializeTable.ts` alike), so
`'table' in img` is reliable.

- **The tilt is a projective map, not a rotation.** `tableProjection.ts` takes the four
  corners (`quad`, in % of the picture's *rendered* rect via `surfaceBaseRect`, so a
  resize, pan or zoom carries the surface with the photograph), solves the homography from
  the unit square and emits one `matrix3d` — where `rotateX`/`rotateY`/`perspective` is a
  three-way search in which each axis undoes the last. The table lays out at
  `quadSourceBox`, the mean of the quad's opposite edges, not at the frame: a
  3D-transformed element rasterises once at its layout size, so one laid out four times
  too large is downsampled lettering.
- **Rows snap because the offset is an index, not a position.** The surface divides into
  `rows` equal bands in un-projected space and scrolling advances an integer index into
  `data`, so band *k* lands in the same place at every offset. Rows outside the window are
  never rendered — which is why there is no scrollbar to hide. `wheelRows` carries sub-row
  remainder so a trackpad's small deltas still move a row; two off-screen buttons and an
  `aria-live` count are the keyboard's version of the wheel.
- **A band is a budget.** A CSS row height is a *minimum*, so content taller than its band
  grows the row and walks every row below it off its line. `BAND_SIT` (lettering's gap
  above its rule) and `STATUS_BAND` (a status illustration's height) in `tableData.ts` are
  fractions of the band, resolved into custom properties by `ProjectedTable.tsx` so
  `table.css` spends them rather than inventing its own; `FONT_SCALE.max + BAND_SIT <= 1`
  is the invariant (`tableData.test.ts`). `.cb-ptable-clip` is the backstop — `hidden`
  over a window nothing scrolls past, not the scroll container rule 18 forbids.
- **The quad is what puts the rows on the drawn lines**, seated against the artwork rather
  than by eye: bands are equal, so the bottom edge belongs *on* the last ruled line and
  the top edge exactly one band above the first (`notepadRuling.test.ts` checks the
  shipped notepad's against `hand-notepad.webp`; replace the picture and those constants
  move in the same commit). **The surface does not draw the ruling** — the drawing already
  rules the sheet. The lines stopping at the writing area are the editor's band guides,
  drawn through the same projection as the rows.

**A surface can show live records instead of authored cells.** `table.source` names a feed
— `'calls'` or `'sms'`, from `TABLE_SOURCES` in `lib/liveTables.ts` — and is **absent** on
an authored surface. The skin names a feed and is handed rows: `hooks/useLiveTables.ts` is
the only module in the chain that touches the API and `lib/liveTables.ts` owns the columns
and record-to-row mapping, so no customer id or endpoint appears under `skins/`. Rows are
injected in `Layout.tsx` between the editor's working copy and the panels
(`useLiveTableImages`), which keeps every component below renderable from a plain config
in a test and keeps the editor holding the authored surface.

- **`data` stays empty for a live surface — a privacy invariant, not tidiness.** The feed
  is call and message history, so saved rows would put real phone numbers into
  `layoutConfig.ts`. Enforced three times: the injection is downstream of the editor's
  config, `coerceTable` empties `data` when a source is set, and the inspector's feed
  switch replaces the cells.
- **A live surface's columns are the feed's**, because the mapper emits cells
  positionally; widths, alignment and headings stay the author's, but the editor hides
  **+ Column** / **−**, and `feedColumns` (`editor/tableValidate.ts`) replaces any list
  that is not the feed's length on the way out of a working copy. It disagrees for exactly
  one reason: a tab older than a change to the feed's shape.
- **`?sim=1` frames a surface against a full table** (`lib/simTables.ts`, dev-only, flag
  in `localStorage['live-tables:sim']`) — a dev database holds two calls. Its rows
  *replace* the poll rather than seeding it, built through the feed's own mapper so no
  cell drifts out from under its heading.
- **Live means polling.** `useLiveTables` re-asks every `LIVE_TABLE_POLL_MS`, skips a
  hidden tab, refreshes on `visibilitychange`, and returns the *identical* row array when
  nothing changed, so a quiet poll does not repaint every canvas. A failed refresh keeps
  the rows already on screen.

## An `actions` balloon is the telephone's keypad, not a toolbar

One button per comma-delimited entry, except the two labels naming the drawn telephone's
own keys — `Call` and `End call` render their artwork from `public/comic-book/`.
`phoneActions.ts` owns both halves, the label→key fold (on letters alone, so `end-call`
and `END CALL` are one key) and the softphone verb each key runs, and is pure.

- **Two keys, four states.** Green answers a ringing call and otherwise dials
  `dialTarget`; red declines one and otherwise hangs up. A handset has one green key and
  one red one whatever the call is doing, so a third never appears.
- **A key with nothing to do is disabled, never hidden** — a control vanishing off a
  photographed telephone reads as a fault in the picture. `bubbleInputs.css` greys a
  disabled key only under `.is-interactive`, so the editor shows the artwork whole.
- **The handlers are props all the way down** — `Layout` → `ComicPanel` → `PanelBubbles` →
  `PanelBubble` → `BubbleActions`. Nothing under `skins/` reaches for the softphone hook,
  so a balloon with no handlers is drawn and inert rather than broken.
- **The number dialled is `dialTarget`**, typed by the projected number pad; a `phone`
  balloon places a call from a field of its own, so the keys take no argument.

## A panel is a phone call while something on it carries a role

A live call splits one panel down a seam and draws both ends facing each other — a *second
layout for that panel*, not a widget: the same pictures and balloons the editor places,
framed against half a panel. **Membership and role are one optional field.**
`call?: CallRole` on an `ImgTransform` or `BubbleTransform` says both that the entry
belongs to the call layout and which part: `ringing` and `remote` are the far end before
and after pickup, `local` is the caller, `scene` spans the panel. **Absence — never
`null` — is the ordinary layout**, so the switch needs no flag, and `callSceneRoles.ts`
owns every question asked of a role so the drawing and the editor's click targets cannot
disagree.

- **`PANEL_CALL_SCENES` is derived and holds only the seam.** `syncCallScenes` rebuilds it
  in `reconcile` from the roles, so "add"/"delete a scene" are not operations; what it
  does hold is the cut and the axis, the one thing no entry implies.
- **The two far-end roles share a half** — whoever framed the ringing telephone framed the
  person who answers it; splitting them jumps the picture across at the pickup.
- **The keys are an ordinary `actions` balloon**, so hanging up is not a callback the
  scene owns and the balloon can be moved, resized and re-lettered.
- **Anything drawn against a half is measured against that half's box**, by `halfFor`, in
  all three places at once: picture, click target, drag. A target measured against the
  panel sits where its picture is not; a drag scaled by the panel travels twice as far as
  the pointer.

## A field is typed into as soon as its panel lights up

There is no click-to-focus on a page drawn as artwork: the panel revealing its balloons
*is* the invitation, for **every** field — `input`, `phone`, either dial, a chain's
composer. `panelKeyboard.ts` owns it as a claim per balloon settled per panel, and
`PanelBubbles` is the router: it collects claims, tracks which balloon the pointer is on,
and hands exactly one balloon `keyboard`. A balloon never decides for itself, because the
answer depends on what else is drawn beside it — precisely what a balloon cannot see.

| Claim | Who | Owns the panel when |
| --- | --- | --- |
| `CLAIM_COMPOSER` | a chain whose sender template is a field | nothing outranks it and nothing is hovered |
| `CLAIM_FIELD` | `input`, `phone`, `dial`, `dial-call` | it is the only field on the panel |
| `CLAIM_POINTER` | `wheel` | only while hovered — it takes the scroll, so a composer beside it must let go |
| `CLAIM_NONE` | lettering, `actions` | never |

Three rules decide it in order: **the pointer wins**, then **the highest claim wins if it
stands alone**, then **a tie owns nothing** — posting keystrokes into whichever input the
config listed first is not a fact the reader can see. **Never re-spell this inside a
balloon**: two components each carried a private half of it, which is why an `input`
balloon drawn anywhere else sat ignoring the keyboard until clicked. A new content kind
joins by naming a claim in `bubbleClaim`, a new panel-level owner by ranking above
`CLAIM_FIELD`.

## Dev-only visual editor

`?edit=1` / `?edit=0` in dev, persisted in `localStorage['comic-book:edit']`, gated on
`import.meta.env.DEV` so it is inert in prod. Click a panel, picture or bubble to select
(a picture wins over the panel under it, a bubble over both); drag, wheel, handles and
arrows adjust, with **Alt** swapping a picture's two framings. **+ Image**, **+ Bubble**,
**+ SMS** and **+ Call** add to the selected panel. The inspector edits every field of the
arrays above — with two deliberate gaps: there is **no chain control** (a conversation is
made by **+ SMS**, never assembled by hand) and a live table surface has no cell block and
no **+ Column** / **−**.

| Control | Notes |
| --- | --- |
| Call layout | **Default** / **Ringing** / **Connected**, present once the page has a call; on Default the call's entries are off screen with no targets or drags. A **call role** select puts an entry in the layout and moves the page to it, or nothing would appear to have happened; **call seam** / **call split** cut the panel, bounded by `CALL_CUT` since an edge cut leaves a half with no area to drag back |
| Chain | **rows**, and **messages** on an *unbound* chain only. Chained balloons render flat in edit mode so each stays selectable, and the table's extent is a dashed frame (`chainFrame.ts`) |
| Table corners | four grips, content mode only, band guides following — align the guides to the ruling in the photograph |
| Mode | **Content** / **Panel shapes**. Picture and bubble click targets are not rendered in shapes mode — a picture-sized target would swallow every drag aimed at a line crossing it |
| Reshape | drag a **line** or **vertex**; a frame vertex slides along its own edge and the four corners are locked. Pictures and bubbles hold their on-screen place, re-expressed against their new panel box (`editor/gridContentRemap.ts`) — only the clip follows the seam. **Double-click** a line to bend it; drag a corner **onto another** to merge (`panelGridMerge.ts`) and **Alt-drag** to tear one apart (`panelGridSplit.ts`); both refuse while the result would be invalid |
| New panel | **Split top / bottom** or **left / right** cuts through the middle of the selected panel's box in all three grids of its page (`configPanels.ts` over `panelGridCut.ts`). The parent keeps its index, name, pattern and the upper/left half; the new panel is appended and the other page's grids gain an empty ring. Refused whole when any grid cannot take it. There is no delete |
| Save | `POST /__comic-editor/save` writes `layoutConfig.ts` (dev server only); **Copy config** / **.ts** are the fallbacks. Never refused — mid-design is when it matters — but it asks once when the working copy is older than the bundle's config, with a red block above the row (`editor/configStamp.ts`); **Reset** takes the file and discards this tab's work |
| Ship | `POST /__comic-editor/ship` saves, branches, commits, pushes and opens or updates a PR (`frontend/shipLayout.ts`). Disabled while the amber `editor/configParity.ts` list is non-empty: every caption needs a tail and both morph targets, every link must resolve within its panel, every picture needs extent and a `/comic-book/` source |

`EditorOverlay.tsx` is dynamically `import()`-ed behind the DEV gate so Rollup tree-shakes
it and `editor.css` out of production; only `layoutConfig.ts`, `bubbleTypes.ts` and
`transforms.ts` ship. All editor math, config editing and serialization is pure and
unit-tested in `frontend/src/tests/skins/`.

## Hard rules — the checklist; the prose above says why

1. **Never use border-radius** — flat ink-cut corners only.
2. **Never use CSS transitions for page navigation** — only the Ben-Day wash canvas.
3. **Never import Three.js, R3F or any WebGL library** — canvas 2D + DOM only.
4. **Never use CSS gradients as backgrounds** — Ben-Day dots, or solid fills.
5. **Never color assets with the CSS `color` property** — only `sepia/saturate/hue-rotate`.
6. **Never render panel ink with CSS `border`** — a panel's ink is its own SVG polygon.
7. **Never use cold or neutral fonts**, and uppercase nav and headings in CSS.
8. **Never hard-code a panel polygon or a gutter offset.**
9. **A panel's pattern animates only while that panel is active**, off its own clock.
   Until 2026-08-25 this rule said the opposite, which is how eight panels came to drift
   at once and pull the eye off the one being pointed at.
10. **Served art is `.webp` under `public/comic-book/` exclusively** — no base64, no
    external URLs, no PNG; masters live in `frontend/assets-src/comic-book/` and
    re-encodes come from there. `frontend/assetPolicy.ts` holds the format rule, the
    dimension ratchet and the **per-page** byte budgets (`MAX_PRELOAD_BYTES` for first
    paint, `MAX_PAGE_BYTES` for the visit — no visitor downloads `public/`) as constants,
    so changing one is a diff that says what a visitor now downloads;
    `assetPolicy.test.ts` checks the served tree both ways. Panel art is fetched **only by
    this skin**, through the guard script in `index.html`, whose `SKINS`/`DEFAULT` must
    match `src/skins/registry.ts` and whose `PANELS` must match `layoutConfig.ts` (same
    test). As static preload tags they were fetched by all four skins — 1.94 MB `barebone`
    never painted — which no static check catches, since the references were real;
    `tests/e2e/test_asset_usage.py` compares fetched against drawn in a browser instead.
11. **Files over 250 lines (TS/TSX/CSS) must be split before commit.**
12. **Never link two bubbles across panels.**
13. **Never give a panel bubble its own tail path** — the tail is a ring vertex.
14. **Never tube a chained bubble, and never give a chain more than one tail.**
15. **Never key a chain's balloons by row** — message indices are what make a scroll
    animate.
16. **Never express a projected table's tilt as rotation angles, and never scroll it by
    pixels.**
17. **Never ink a picture, and never give a picture's frame the panel's shape.**
18. **Never give a projected table a scroll container, scrollbar or any chrome outside
    edit mode.**
19. **Never size anything inside a cell in `em`** — use the band fractions in
    `tableData.ts`.
20. **Never let a bound (`sms: true`) chain fall back to its authored `messages`, and
    never bind one in edit mode** — the first puts the author's lettering into somebody's
    real thread, the second spends money from the editor.
21. **Never fetch from a skin, and never save a live surface's rows.**
