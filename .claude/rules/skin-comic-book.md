---
description: Comic Book skin visual design conventions (Lichtenstein pop-art page layout)
paths:
  - frontend/src/skins/comic-book/**/*.ts
  - frontend/src/skins/comic-book/**/*.tsx
  - frontend/src/skins/comic-book/**/*.css
---

# Rule: Comic Book Skin — "POW!"

> **Scope:** This rule applies only to the `comic-book` skin (`frontend/src/skins/comic-book/`).
> For the skin system architecture itself, see `.claude/rules/skin-architecture.md`.

## Tech Stack

**Renderer:** React DOM + Canvas 2D (for Ben-Day dots, panel lines, the wash overlay)
**Animation:** CSS `@keyframes` + `requestAnimationFrame` canvas loops (no spring libraries)
**Assets:** `<img>` tags pointing to Gemini-generated **`.webp`** in `public/comic-book/` — desaturated via CSS `filter: grayscale(1)` at rest, re-colorized on hover via CSS custom-property driven `filter: sepia(1) saturate(X) hue-rotate(Ydeg)`. The PNG masters they were encoded from live in `frontend/assets-src/comic-book/`, **outside the served tree**: Vite copies `public/` into `dist/` verbatim, so while the masters sat beside the WebPs every build shipped ~24 MB of PNG that no page ever requested.
**Page transitions:** Ben-Day wash — a wave of paper-colored halftone dots sweeps diagonally from the top-left corner, merges into a solid sheet carrying the loading screen's ripple, then shrinks away to reveal the incoming page (`benDayWash.ts`)
**Fonts:** `Bangers` (Google Fonts, display/headings), `Comic Neue` (body text)

## Color Palette

| Token | Hex | Role |
| --- | --- | --- |
| `--cb-yellow` | `#FFE033` | Panel 1 accent / background |
| `--cb-red` | `#E8003D` | Panel 2 accent / danger |
| `--cb-blue` | `#0057B8` | Panel 3 accent / primary |
| `--cb-green` | `#00A651` | Panel 4 accent / success |
| `--cb-cyan` | `#00AEEF` | Panel 5 accent / info |
| `--cb-magenta` | `#EC008C` | Panel 6 accent / highlight |
| `--cb-black` | `#111111` | Ink lines, panel borders, text |
| `--cb-white` | `#FAFAF2` | Page background / balloon fill |
| `--cb-dot-alpha` | `0.18` | Ben-Day dot opacity at rest |
| `--cb-dot-hover-alpha` | `0.35` | Ben-Day dot opacity on hover |

Each nav section / page is assigned **one accent color**. The entire viewport background Ben-Day dots shift to that color when the page is active.

### Page → color mapping

| Route | Accent |
| --- | --- |
| Dashboard | `--cb-yellow` |
| Phone Lines | `--cb-blue` |
| Extensions | `--cb-red` |
| (any other) | `--cb-cyan` |

## Layout System

The layout is a **comic-book page** decomposed into panels:

- The root `<Layout>` renders a full-viewport canvas that draws:
  1. A Ben-Day dot raster background in the current page accent color
  2. Thick black ink panel-separator lines (4–6 px, drawn at comic-panel angles — never a pure CSS grid)
- Each view fills one or more of these panels
- Navigation lives in a **caption box** — a yellow rectangular label with thick black border and `Bangers` text, pinned top-left, overlaid on the canvas
- Speech bubbles are used for status messages / error callouts — pure CSS `clip-path: polygon(…)` shapes with a tail

### Panel grid (default per-page)

Views must tile their content inside the panel regions. Use `position: absolute`
panels over the canvas; exact coordinates are computed at runtime from
`window.innerWidth / innerHeight`.

The regions come from `PANEL_GRIDS` in `editor/layoutConfig.ts` — one **shared-vertex
planar subdivision** per window shape (`landscape` / `portrait` / `square`, picked by
`layoutKindFor`). Each grid is one table of normalised `[x, y]` vertices plus one ring
of indices per panel, index-parallel to `PANELS`. `panelGeometry.ts` turns a grid into
viewport polygons: the outer frame is the viewport inset by `OUTER_M`, and each ring is
then inset by `HALF_GUTTER` **perpendicular to every edge** (`polygonInset.ts`), so the
gutter is the same width whatever angle a line runs at. A per-axis inset — what this
replaced — narrows by the cosine of the angle, and a diagonal reads as a thinner line
the further it leans.

Three properties are structural rather than enforced, and should stay that way:

- **The outer frame is not editable.** A frame edge belongs to exactly one ring, so it
  is never a line *between* two panels, so the editor draws no handle on it.
- **Panels cannot come apart.** The two rings either side of a line name the same
  vertex indices, so one move moves both sides. Nothing copies the change across.
- **No T-junctions.** A vertex lying on another panel's edge must be an endpoint of
  that edge too; `panelGridValidate.ts` rejects a grid where it is not, and a persisted
  grid that fails falls back to the shipped one rather than rendering torn.

### Two pages, one panel list

There are two pages of panels: the **4-panel home page** on `/` and the **classic
8-panel grid** everywhere else (the old home page set aside, not destroyed).
`pageForPath` in `panels.ts` picks the page from the route; every panel of both pages
lives in the one `PANELS` list, each naming its `page`. `PANEL_GRIDS` is a
`PageGrids` record — one set of three grids per page — and **every grid's ring table
is `PANELS`-length**: a panel that lives on the other page keeps its slot as an empty
ring, which `gridPolys` returns as a vertex-less polygon and `Layout.tsx` maps to
`null`. Consumers keep indexing panels and polygons by the same number and must guard
the nulls. Both pages share the same visual system — the outer frame, perpendicular
gutters and slanted dividers all come from the same geometry.

## Component Patterns

### Button

```tsx
<button className="cb-button" data-accent="yellow">
  KAPOW!
</button>
```

- Black 3 px border, 2 px black box-shadow offset `(3px, 3px)`
- Font: `Bangers`, 20 px, letter-spacing 2 px
- Background: current panel accent color
- On hover: box-shadow grows to `(5px, 5px)`, background lightens 10 %
- On active/press: box-shadow collapses to `(1px 1px)`, translate `(2px, 2px)`
- NO border-radius — flat ink-cut corners only

### Card / Panel

Each data card sits **inside** a drawn canvas panel region. Cards are `position: absolute` with:

- A thick `3px solid #111111` border
- A background of `--cb-white`
- An optional accent color top-bar (8 px tall, full width)
- Drop-shadow: `4px 4px 0 #111111` (ink offset, no blur)

### Speech Bubble (status / error)

```tsx
<div className="cb-bubble" data-type="shout">
  ERROR: NO SIGNAL!
</div>
```

- White fill, 3 px black border
- `clip-path` round bubble (ellipse) or spiky "shout" shape
- Tail pointing down-left toward the triggering element
- Font: `Bangers` for shout, `Comic Neue Bold` for speech

This inline callout is a **different component** from the panel speech bubbles
below, which are generated vector shapes. It stays CSS-shaped; it does not morph
and cannot be linked.

### Panel speech bubbles — generated, not drawn

Panel bubbles are SVG outlines generated by `bubbleShape.ts` (from the authoring box
in `bubbleBox.ts`) and rendered by `PanelBubbles.tsx` / `PanelBubble.tsx`.
Deliberately plain: **thick black outline, flat white fill, no texture, no gradient,
no Ben-Day dots inside.**

Every type is one closed ring of the same 64 vertices sampled from a shared ellipse
and differing only in a radial modulation. That shared ring is the load-bearing
constraint — it is what lets any shape interpolate vertex-for-vertex into any other,
so a hover or click **morphs** rather than crossfades.

There are **three** types, and each one earns its place by being unmistakable at a
glance:

| Type | Outline | Why it is shaped that way |
| --- | --- | --- |
| `soft` | the bare ellipse | speech; 64 straight segments read as smooth |
| `cloud` | union of 8 overlapping lobes | a thought bubble is *meshed ellipses*, so its lobe junctions cut back **inside** the base ellipse. A modulation that only bulged outward read as a scalloped balloon |
| `lightning` | 15 traced spikes (`boltShape.ts`) | action; a 1960s pop-art impact burst. Valley → straight climb → straight fall, so every turn is a corner |

`lightning`'s spikes are a **table, not a formula**, and that distinction is the whole
reason it reads as a burst. Two earlier versions modulated the ellipse — a cosine, then
a jittered triangle wave — and both read as a **sun**, because any radial function of
the angle spaces its spikes evenly and gives them broadly one length. Piling on more
jitter does not fix that; it only makes a soft shape noisy.

The table itself is **traced from the reference drawing**,
`assets-src/comic-book/jagged bubble.png`: each entry is one of its fifteen real spikes,
read off the outline's radial profile around its interior centroid and quantised onto
the ring. A third hand-authored attempt is the one move known not to work — two
preceded the trace and both drifted back toward even spacing, shallow notches and
mid-length spikes, because the drawing's actual swings (notches to 0.67, reach spread
0.17–1.0) look like mistakes until they are measured. Retune it by re-tracing the
reference, and keep the spans summing to the ring — that budget is the morph invariant
above, not a detail of this type.

Three consequences worth knowing before editing either file:

- **An edge is a chord, not a radius ramp.** A non-corner vertex takes the radius
  where its ray crosses the straight line between the two corners around it.
  Interpolating the radius itself across the ring — the obvious spelling — sweeps it
  across changing angles and bows every edge into a shallow arc, which is precisely
  the softness the reference does not have. The straightness test in
  `boltShape.test.ts` pins this.
- **`boltMod` clamps every vertex against the viewBox at its own angle.** The box is
  padded below the ellipse and tight at the flanks, so a sideways spike has far less
  headroom than a diagonal one; the clamp is what makes the flank spikes shorter
  without the table encoding the box's shape by hand. The burst it replaced cleared
  the edge only because no crown happened to land on a lateral extreme.
- **`.cb-bubble-shape` joins with `miter` and a raised `stroke-miterlimit`.** A round
  join sands the point off an acute spike, and the SVG default miterlimit bevels one —
  the same lost point by another name. An outline drawn as a polygon has to be inked
  as one.

A fourth "shout" type used to sit beside `lightning` and was removed: it was the same
spiky drawing at a lower amplitude, so nothing in the panel or the editor dropdown
distinguished them. Loud lettering, not a fourth outline, is what makes a shout.

- **A new bubble type is a new entry in `SHAPES`**, not new artwork. Two images can
  only crossfade, which is exactly what this replaced. Before adding one, say what it
  reads as that the three above do not.
- **Never change the ring's vertex count for one type.** A type with a different
  count silently breaks every morph into and out of it.
- `bubbleTypes.ts` carries only the lettering font and label per type. **No `src`
  field** — a bubble that points at an image has stopped being morphable.
- The morph writes the path's `d` attribute from a `requestAnimationFrame` loop
  (`useBubbleMorph.ts`). The `<path>` therefore carries **no `d` prop**; a
  React-rendered one fights the loop and snaps the shape mid-morph.

**The tail is one ring vertex pulled outward**, chosen by the bubble's `tail`
direction (`TAIL_DIRS` in `bubbleBox.ts`: eight compass directions plus `'none'`).
Turning or removing a tail is therefore an ordinary morph, not a second shape system
— which is the reason it must stay a ring vertex rather than becoming a separate
`<path>`. Tail ink leaves the viewBox on purpose; `.cb-panel-bubble-svg` sets
`overflow: visible` instead of padding the box, because padding it would rescale
every bubble already placed.

### A bubble — and a picture — belongs to a panel

Neither `PANEL_BUBBLE_TRANSFORMS` nor `PANEL_IMG_TRANSFORMS` is index-parallel to the
panels; each entry names its own `panel`. A panel may own several balloons and several
pictures, or none of either, and each array's length is the author's. `panel` is the
whole association: placement is measured against that panel's box, and hovering that
panel is what reveals its bubbles (`isBubbleRevealed` in `bubbleTube.ts` is exactly
that comparison).

`PANELS` (`panels.ts`) is the one parallelism that survives — a panel is a fixed slot
in the grid, so there are exactly as many of those as there are polygons, whatever ends
up drawn on each.

A picture carries **two independent framings**, and conflating them is the mistake to
avoid: `left`/`top`/`width`/`height` are its frame over the panel box (in % of that
box), while `scale`/`offsetX`/`offsetY`/`anchor` move the picture *within* that frame.
The frame used to be the panel polygon itself, so dragging a picture could only slide it
under a window that stayed put; a frame left at `0/0/100/100` still crops exactly as it
did.

**A picture is not a panel, and the renderer must never make one look like one.** The
frame is a plain rectangle; the *panel* is the window, applied as the panel's own
polygon translated into the frame's coordinates (`imgPanelClip`), so what shows is the
intersection of the two — the picture keeps its own square edges and is cut only where
the panel's ink actually runs. Two earlier spellings did make a picture a panel and both
were wrong in the same way: the clip scaled the panel polygon *into* the frame, giving an
inset picture the grid's slanted gutters, and `PanelInk` stroked a second 5 px black
polygon around any frame that was not the whole panel. In the editor that black shape
sat over the selection outline, which traces the artwork's real rect (`imgVisibleRect`),
so the two disagreed on screen about where the picture was. Pictures get no ink of their
own; `PanelInk` takes `polys` and nothing else.

### Connector tubes

Linked bubbles are joined by a thin white corridor (`bubbleTube.ts`,
`BubbleTubes.tsx`) — the comic convention for one speaker continuing across two
balloons. `linkTo` in `PANEL_BUBBLE_TRANSFORMS` declares the link, symmetrically:
one end is enough.

**Both ends must sit on the same panel.** Half a tube surfacing on a different
hover cannot read as one utterance, so the rule is enforced twice by construction:
`linkCandidates` never offers a cross-panel partner to the author, and `linkedPairs`
drops any cross-panel link it is handed. Every config edit that can orphan a link —
a delete, an add, a panel change — runs `sanitizeLinks`.

The corridor is **welded by paint order, not by a path union**: it sinks into both
bubbles and the tube layer paints above them (z-index 9), so its white fill erases
the slice of outline it covers. Both z-indices are load-bearing — above the lifted
panel (z 8), below the Ben-Day wash (z 10). Overlapping bubbles draw no tube at all,
by design; a corridor shorter than its own width reads as a smudge.

### Bubble chains — two balloons read as an SMS thread

A bubble's `chain` id joins it to a **conversation drawn as two columns**
(`bubbleChain.ts`, rendered by `PanelBubbleChain.tsx`): the recipient speaks down the
left column, the sender down the right, and the rows run in the order the messages were
sent, so one party saying two things in a row simply takes two rows in a row.

**The members are templates, not slots.** The author draws *one balloon per column* —
its shape, tail, rotation, lettering and the column's edge — and every row is stamped
from the template of the side it belongs to. Member 0 is the **sender**: the rightmost
column, the one the composer sits at the foot of. Rows are laid out bottom-up from it,
each row's `top` the running sum of the heights below it, so a long message pushes the
thread up by its own height rather than by a fixed pitch a two-line balloon would
overlap. Width follows the message (`messageWidth`); the template's own width is the
widest a balloon on that side gets.

**Linkage is what joins the two columns**, not a name: a chain's members are the
balloons wired together by `linkTo`, and one checkbox on either says which of the two a
linked group is — a welded pair, or a conversation. The id the group carries is
generated (`nextChainId`) and never shown.

`PANEL_BUBBLE_CHAINS` in `layoutConfig.ts` holds one entry per id in use:

| Field | Effect |
| --- | --- |
| `grow` | plays the transcript in one message at a time, `stepMs` apart, instead of filling the table at once |
| `rows` | how many rows are on screen at once, counting the composer's; past that the wheel moves a window |
| `messages` | the thread, oldest first; a leading `> ` marks the **sender's** side. **Empty means the chain speaks its two balloons' own `text`** |
| `sms` | binds the conversation to the account's real SMS history — see below |

The list is **derived, not authored**: `syncChains` recomputes it from the ids the
bubbles carry after every edit that can touch one. There is deliberately no add-chain or
delete-chain operation — a chain with no members and a member with no chain are both
unreachable states rather than states to be validated.

Scrolling is not a toggle: a chain *is* a window over a transcript, so the wheel always
moves it. **Live** is `content: 'input'` (or `'phone'`) on the sender template — the
composer takes the bottom row and messages start one row up.

These rules hold it together, each enforced where it can be enforced by construction:

- **A chained balloon takes no tube.** A row holds whatever message the transcript put
  there, so a tube welded to it would join a different sentence each time. Dropped in
  `sanitizeLinks` (data), never offered by `linkCandidates` (editor), and refused by
  `linkedPairs` (renderer) — the same three-place pattern as the same-panel rule.
- **A chain is one panel's.** `chainMembers` filters on panel as well as id, so two
  panels never draw one conversation between them.
- **Only up.** The window arithmetic assumes time runs upward: the newest message sits
  where the composer is and older ones climb away. A horizontal chain is not a supported
  layout — it would need a second axis in every one of those functions, not a CSS change.

All of the arithmetic is pure and in `bubbleChain.ts`; `PanelBubbleChain.tsx` adds only
what cannot be — the growth timer, the wheel listener, the panel's measured aspect and
what a reader typed. **Keys are message indices, not row indices**: a message keeps its
DOM node as it moves up the table, which is what lets CSS transition its
`top`/`right`/`width` rather than flickering text through stationary balloons. The
arrival effect is a `@keyframes` animation (`bubbleChains.css`) and not a transition,
because a node that mounts already carrying `is-visible` has no previous value to
transition from.

### A chain bound to real SMS

`sms: true` stops a chain being a drawing. The transcript then comes from the carrier
instead of from `messages`, and Enter in the composer **sends for real** — there is no
safe mode, and the account is billed.

**Which conversation is not stored on the chain.** It is whichever number the panel's
wheel-picker balloon is turned to: `peerWheelOn` takes the first `content: 'wheel'`
balloon on the panel **that is not itself in a chain**, because a wheel inside a
conversation is picking what to *say*, not who to say it to. The option is read through
`toE164` (`phoneInput.ts`), so the same number written three ways is one thread; an
option that is a name resolves to null and binds nothing. The two halves are separate
balloons on purpose — the picker says *who*, the chain says *what* — which is how the
panel reads as a phone rather than as a form.

The data still obeys the three-layer rule (`.claude/rules/skin-architecture.md`): nothing
in the skin fetches. `App.tsx` owns `useSmsConversations()` and passes it as
`LayoutProps.sms`; `PanelBubbles` calls `subscribe(peer)` and reads what comes back. The
hook polls (`SMS_POLL_MS`) only while somebody is subscribed and shares one request
between subscribers, so a page whose panels bind nothing costs nothing — which is what
lets `App` mount it for every skin. A sent message is drawn optimistically and retires
when its own row returns from the server (`mergeMessages`); until then it carries
`is-sending`, and a refused send carries `is-failed`.

Two things a bound chain must never do, both asserted in
`src/tests/skins/PanelBubblesSms.test.tsx`:

- **Never fall back to the authored transcript.** A bound chain that resolved no number
  shows an empty conversation. The fallback would put the author's words into somebody's
  real thread.
- **Never bind in edit mode.** The editor is the author placing balloons; a panel under
  it must not poll a carrier, and Enter in a composer there must not spend money.

### Asset Image (Gemini-generated)

```tsx
<img
  className="cb-asset"
  src="/comic-book/receptionist.webp"
  alt="Agent character"
/>
```

| State | `filter` |
| --- | --- |
| Rest | `grayscale(1) contrast(1.1)` |
| Hover | `sepia(1) saturate(4) hue-rotate(var(--cb-hue-deg, 0deg))` |

`--cb-hue-deg` is set per-asset to target the correct accent color hue.

## Typography

| Usage | Font | Weight | Size | Case |
| --- | --- | --- | --- | --- |
| Page titles / nav labels | Bangers | 400 (display) | 28–48 px | UPPERCASE |
| Section headings | Bangers | 400 | 22–28 px | UPPERCASE |
| Body / data text | Comic Neue | 700 | 14–16 px | Sentence |
| Caption boxes | Bangers | 400 | 14 px | UPPERCASE |
| Error / status bubbles | Bangers | 400 | 18 px | UPPERCASE |

Fonts loaded from Google Fonts in `index.html`: `Bangers` (400) and `Comic Neue` (400, 700).

## Motion & Animation

### Ben-Day dot motion — only on the active panel

One `requestAnimationFrame` loop drives every panel's dot canvas (`usePanelDots.ts`),
but a panel is repainted only while it is **active** — hovered, which is also when its
picture colorizes. A resting panel keeps the frame it stopped on.

**Each panel owns its clock, and the clock is what stops** (`panelDotAnim.ts`). Drawing
from a shared wall clock is the version to avoid: the pattern would jump forward by
however long the pointer had been away the moment it returned, so every departure and
return would land as a cut instead of a pause and a resume. Panels are seeded from
their shipped `phase`, so a page at rest is not eight copies of one frame. An inactive
panel is repainted for exactly one reason — its canvas went blank (resize, remount, or
a pattern switch in the editor) — and then at the clock it froze on, not a fresh one.

This is why eight simultaneous patterns cost one panel's worth of drawing, and why the
eye is not pulled off the panel the pointer is on.

Every style in `PATTERN_STYLES` moves, and every one is tuned far slower than the
3-second breathe cycle — the drift should be noticed after watching, never read as a
moving image. The renderers are split by *what* moves: `patternDrawFields.ts` drifts
the field the dots are sized from, `patternDrawRadial.ts` turns a focal pattern.

**`concentric-rings` is the reference motion, and `patternWave.ts` is where it lives.**
A wave travels through the dot field; dots swell and ink up as its crest arrives, then
shrink and fade as it leaves. Every style is built from that same `travellingWave`
term rather than its own drift — which is what keeps eight patterns reading as one
page. Two rates and a spin are the whole vocabulary: `WAVE_RATE` for a wave expanding
from a point, `SWEEP_RATE` (half of it) for one crossing the panel in a straight line,
`SPIN_RATE` for a ray fan.

A slow drift of a whole field is the shape to avoid, and three styles shipped it
before 2026-08-25: slow enough to read as calm is slow enough to look static, and fast
enough to see is the entire picture sliding. A wave through a still field is legible
at a slow pace because the eye tracks its crest instead of the field.

| Style | What moves |
| --- | --- |
| `halftone-gradient` | a wave sweeps down the gradient axis; the dense end also drifts along it |
| `sunburst` | the ray fan turns, one revolution in ~6 minutes |
| `color-block` | a swell travels along the zone boundary, on a slower tide |
| `vignette` | rings run out through the dark edge; the clear middle opens and closes like an aperture |
| `radial-dots` | rings run out from a focal point that wanders an open loop (two rates, so it never quite retraces) |
| `diagonal-stripes` | a wave sweeps across the panel at the band angle, one band per ~14 s |
| `concentric-rings` | ring waves travel outward from the focal point |
| `corner-burst` | the same wheel of rays as `sunburst`, turning at the same rate, seen from a corner |

`corner-burst`'s fan covers the **whole circle** even though a corner shows a quarter
of it. A fan spanning only the visible quarter cannot turn — rotate it and it swings
off the panel — so it rocked about a fixed axis instead, which reads as a twitch. Its
`rayCount` keeps sunburst's meaning of wedges *across the panel*, and the wheel is
built with four times that many.

Dot radius also breathes ± 0.35 px on a 3-second sine, shared by every style —
which is why `panelPatternMotion.test.ts` leaves radius out of the frame signature it
compares. A style that only breathed would otherwise pass a test for animating.

### Hover colorization

Asset images transition from grayscale to colorized via CSS `transition: filter 200ms ease-out`. No JS required.

### Page transition — Ben-Day wash

All math and drawing live in `benDayWash.ts`; `Layout.tsx` listens for React Router
`location` changes and drives a `requestAnimationFrame` loop on a single full-viewport
canvas (`.cb-wash-canvas`, blank when idle). A halftone wave travels along the `x + y`
diagonal from the top-left corner:

1. **Phase 1 — Cover (420 ms):** paper-colored (`--cb-white`) dots grow inside a 220 px wave-front band until they merge into an opaque sheet (merge radius `spacing × 0.75` ≥ the `S·√2/2` tiling bound). The old page is washed away under the sheet.
2. **Phase 2 — Hold (120 ms):** full coverage. The sheet carries the loading screen's diagonal Ben-Day ripple, tinted with the incoming page's accent color — visually identical to the loading overlay.
3. **Phase 3 — Reveal (420 ms):** the same wave passes on; dots shrink behind the reveal front, uncovering the new page.

| Property | Value | Notes |
| --- | --- | --- |
| Grid spacing | `20 px` | shared with the loading ripple so the surfaces align |
| Wave band depth | `220 px` | growing/shrinking dot edge |
| Ripple wavelength / speed | `260 px` / `0.55 cycles·s⁻¹` | identical constants for wash and loading screen |
| Easing | ease-in-out cubic per phase | `washPhaseAt(elapsedMs)` |

The loading overlay uses the same module: its background is `drawLoadingRipple` (paper +
full ripple on the same grid), and when assets finish loading it exits via the wash's
reveal phase (`drawWash` with cover pinned at 1) instead of snapping away — the loading
screen and page transitions are one continuous visual system.

### Panel separator lines

Each panel is stroked as one closed `<polygon>` on a viewport-level SVG above the
pictures (`stroke="#111111"`, `strokeWidth="5"`, `strokeLinejoin="miter"`), so a panel's
ink follows its shape however the grid is dragged. There is no separate line layer:
what reads as a separator is the two panels' own borders either side of the gutter.
The Ben-Day dots are still per-panel canvases, clipped to the same polygon.

## Per-Panel Image & Bubble Framing

`editor/layoutConfig.ts` is the **source of truth** for the panel shapes
(`PANEL_GRIDS`, above), for picture placement and framing (`PANEL_IMG_TRANSFORMS`),
for speech-bubble placement and behaviour (`PANEL_BUBBLE_TRANSFORMS`), for the chain
settings those balloons name (`PANEL_BUBBLE_CHAINS`, above) and for each panel's
background pattern style (`PANEL_PATTERNS`). The renderer in `Layout.tsx` reads from
those arrays — there are **no magic framing numbers** in `Layout.tsx` or the CSS for
images and bubbles, and no bubble text. To retune them, use the editor rather than
hand-editing scattered values.

Every field of those arrays, the rule that **save overwrites `layoutConfig.ts`
verbatim**, the projected-table surface a picture may carry, and the dev-only visual
editor's full control reference live in
[skin-comic-book-framing.md](skin-comic-book-framing.md) — split out of this file so
neither grows past the instruction-size limit.

## Hard Rules Summary

1. **Never use border-radius** on panels, buttons, or cards — flat ink-cut corners only
2. **Never use CSS transitions for page navigation** — only the Ben-Day wash canvas effect
3. **Never import Three.js, R3F, or any WebGL library** — this skin is canvas 2D + DOM only
4. **Never use CSS gradients as backgrounds** — Ben-Day dots only; solid fills for panels
5. **Never color assets with CSS color property** — always via `filter: sepia/saturate/hue-rotate`
6. **Never render panel separator lines with CSS `border`** — a panel's ink is its own SVG polygon, so it follows the shape the grid gives it
7. **Never use cold/neutral fonts** — only Bangers (display) and Comic Neue (body)
8. **All text in nav/headings must be UPPERCASE** — enforce at CSS level with `text-transform: uppercase`
9. **A panel's Ben-Day pattern animates only while that panel is active** — hovered and colorized. At rest it holds the frame its own clock froze on; it never restarts, and it never runs off a shared wall clock. Until 2026-08-25 this rule said the opposite ("must always be running … even when no interaction is happening"), which is how eight panels came to drift at once and pull the eye off the one being pointed at
10. **Served Gemini assets live exclusively in `public/comic-book/`, and are `.webp`** — no inline base64, no external URLs, and no PNG. The lossless masters belong in `frontend/assets-src/comic-book/`, which is not copied into the build; re-encode from there rather than from a `.webp`. **`frontend/assetPolicy.ts` is where this stops being advice**: it holds the format rule, the per-image and whole-tree byte budgets and the dimension ratchet as exported constants, and `frontend/assetPolicy.test.ts` checks the served tree against them both ways — an asset nothing references fails as dead weight, and a path named in a comment or in this file fails once the file it names has moved. Change a budget by editing the constant, so the diff says what a visitor now downloads. **Panel art is fetched only by this skin**, through the guard script in `index.html`: its `SKINS`/`DEFAULT` must match `src/skins/registry.ts` and its `PANELS` must match `editor/layoutConfig.ts`, both asserted by that same test file. As static `<link rel="preload">` tags the panels were fetched by all four skins — 1.94 MB of art `barebone` never painted — which no static check can catch, because the references were real; `tests/e2e/test_asset_usage.py` catches it in a browser instead, by comparing what each skin fetched against what it drew
11. Files over 250 lines (TS/TSX/CSS) must be split before commit.
12. **Never link two bubbles across panels** — a tube's two ends share one `panel`, or there is no tube
13. **Never give a panel bubble its own tail path** — the tail is a ring vertex, so `'none'` and a turn both morph
14. **Never hard-code a panel polygon or a gutter offset** — panel shapes come from `PANEL_GRIDS` through `gridPolys`, and the gutter is one perpendicular inset. A polygon written anywhere else stops moving when the grid does, and an offset applied per axis is the wrong width on every diagonal
15. **Never tube a chained bubble, and never give a chain more than one tail** — a row holds whatever message the transcript put there, so a tube would join a different sentence on each turn of the wheel; the tail belongs to each column's template alone, and a stack of them reads as several people talking at once
16. **Never key a chain's balloons by row** — keying by message index is what makes a scroll animate, because the node moves and CSS transitions its position. Keyed by row the nodes stand still and their text flickers
17. **Never express a projected table's tilt as rotation angles, and never scroll it by pixels** — the tilt is four corners solved into one `matrix3d` (`tableProjection.ts`), and the scroll offset is an integer row index. Angles cannot be dragged onto a photograph, and a pixel offset puts the lettering between two ruled lines
18. **Never ink a picture, and never give a picture's frame the panel's shape** — only panels are stroked, and a frame is a rectangle windowed by its panel. A black outline in the grid's slant around something that is not a panel is the mistake this rule exists to stop repeating; the editor's selection outline traces the artwork's own rect, and a second, differently-shaped border beside it is a renderer contradicting the author
19. **Never give a projected table a scroll container, a scrollbar, or any chrome outside edit mode** — rows past the window are not rendered at all, and the guides, outline and corner grips exist only while the editor is open
20. **Never let a bound (`sms: true`) chain fall back to its authored `messages`, and never bind one in edit mode** — the first puts the author's lettering into somebody's real thread, the second spends money from the editor
