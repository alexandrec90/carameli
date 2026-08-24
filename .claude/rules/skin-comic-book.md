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
box, cut to the panel's polygon scaled into it by `imgFramePoly`), while
`scale`/`offsetX`/`offsetY`/`anchor` move the picture *within* that frame. The frame
used to be the panel polygon itself, so dragging a picture could only slide it under a
window that stayed put; a frame left at `0/0/100/100` still crops exactly as it did.

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

### Ben-Day dot breathing

The dot canvas animates continuously with `requestAnimationFrame`, slowly shifting dot radius ± 0.5 px over a 3-second sine cycle. This is always running — never paused.

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

`editor/layoutConfig.ts` is the **source of truth** for the panel shapes themselves
(`PANEL_GRIDS`, above), for picture placement and framing
(`PANEL_IMG_TRANSFORMS`: panel / src / alt / left / top / width / height / scale /
offsetX / offsetY / anchor / spill, with `src` drawn from the `PANEL_ASSETS` manifest
in `editor/assets.ts`) and speech-bubble
placement and behaviour (`PANEL_BUBBLE_TRANSFORMS`: panel / top / right / width /
rotate / spill / type / tail / content / text, plus `hoverType` / `clickType` event
morph targets and the `linkTo` tube partner; `content: 'wheel'` presents `text` as
comma-delimited options on a scroll picker — see `wheelPicker.ts`). The renderer in `Layout.tsx` reads from these
arrays — there are **no magic framing numbers** in `Layout.tsx` or the CSS for
images/bubbles, and no bubble text. To retune them, use the editor rather than
hand-editing scattered values.

**Save overwrites `layoutConfig.ts` verbatim** with what `serialize.ts` emits, so
anything that module does not write is deleted on the first save. That is why the
file's explanatory comments are emitted as headers by `serialize.ts`, and why nothing
else — a `NEW_IMAGE` or `NEW_BUBBLE` default, a helper — may live in `layoutConfig.ts`.
Config edits themselves live in `configOps.ts` (React-free: seed/hydrate/patch,
add/remove picture or bubble, link sanitation), which re-exports `configSeed.ts` and
`configHydrate.ts`; grid edits live in `panelGridOps.ts`.

The bubble box's on-screen geometry comes from `bubbleRect` in `transforms.ts`, used
by **both** the renderer (to aim tubes) and the editor (hit target and selection
outline). Keep it shared: when those two disagreed, the bubble you could click was
not the bubble a tube pointed at.

### Dev-only visual editor

| Property | Value | Notes |
| --- | --- | --- |
| Enable / disable | `?edit=1` / `?edit=0` in dev | Flag persists in `localStorage['comic-book:edit']`; `?edit=0` clears it |
| Gate | `import.meta.env.DEV && (?edit=1 \|\| flag)` | Never ships — `?edit=1` is inert in prod |
| Select | click a **panel**, a **picture** or a **bubble** | A picture wins over the panel under it, a bubble over both; a panel is only outlined — it is the slot the **+** buttons add to |
| Adjust | drag / wheel / handles / arrows | Move the frame or bubble, resize (bottom-right grip), pan the picture inside its frame (top-left grip, picture only), rotate (top-right grip, bubble only), nudge (⇧×10); for a picture **Alt** swaps the two framings |
| Add / remove | **+ Image** / **+ Bubble** toolbar buttons, **Delete image** / **Delete bubble** in the inspector | Adds to the selected panel; deleting a bubble clears any link naming it |
| Picture fields | inspector selects | panel, picture (`PANEL_ASSETS`), alt (empty = decorative), anchor, spill |
| Bubble fields | inspector selects | panel, type, **tail** (nine options incl. **No tail**), **content** (Text / Wheel picker — wheel splits the text on commas into scrollable options), text, hover/click morph, link |
| Pages | **Page** dropdown in toolbar | Switch route in edit mode (replays the wash); "Loading screen" entry previews the loading overlay + its exit wash |
| Mode | **Content** / **Panel shapes** toggle | Content places pictures and bubbles; shapes drags the lines between panels. Content click targets are not rendered in shapes mode — a panel-sized target would swallow every drag aimed at a line crossing it |
| Reshape | drag a **line** or a **vertex** | A frame vertex slides along its own edge; the four corners are locked; the frame itself has no handle. Arrows nudge (⇧×10) |
| Bend | **double-click a line**, drag the bend; **Delete** / **Straighten** removes it | Repeat for lightning bolts. A junction of three lines, or a vertex on the frame, is not a bend and is refused |
| Reset shapes | **Reset shapes** in the shapes inspector | Restores the current window shape's grid only — the three are edited independently |
| Save | **Save** button | `POST /__comic-editor/save` writes `layoutConfig.ts` (dev server only); **Copy config** / **.ts** are the fallbacks |
| Reset all | clears working copy | Removes `localStorage['comic-book:editConfig']`, re-seeds from source |

`EditorOverlay.tsx` is dynamically `import()`-ed behind the DEV gate so Rollup
tree-shakes it (and `editor.css`) out of the production bundle. Only `layoutConfig.ts`
(data), `bubbleTypes.ts` (data) and `transforms.ts` (pure CSS/math) ship in prod. All
editor math, config editing and serialization is pure and unit-tested in
`frontend/src/tests/skins/` (`editorConfigOps`, `editorSerialize`, …). See
`frontend/src/skins/comic-book/editor/README.md` for the quick-start.

## Hard Rules Summary

1. **Never use border-radius** on panels, buttons, or cards — flat ink-cut corners only
2. **Never use CSS transitions for page navigation** — only the Ben-Day wash canvas effect
3. **Never import Three.js, R3F, or any WebGL library** — this skin is canvas 2D + DOM only
4. **Never use CSS gradients as backgrounds** — Ben-Day dots only; solid fills for panels
5. **Never color assets with CSS color property** — always via `filter: sepia/saturate/hue-rotate`
6. **Never render panel separator lines with CSS `border`** — a panel's ink is its own SVG polygon, so it follows the shape the grid gives it
7. **Never use cold/neutral fonts** — only Bangers (display) and Comic Neue (body)
8. **All text in nav/headings must be UPPERCASE** — enforce at CSS level with `text-transform: uppercase`
9. **Ben-Day dot canvas must always be running** (never frozen on a static frame) even when no interaction is happening
10. **Served Gemini assets live exclusively in `public/comic-book/`, and are `.webp`** — no inline base64, no external URLs, and no PNG. The lossless masters belong in `frontend/assets-src/comic-book/`, which is not copied into the build; re-encode from there rather than from a `.webp`. **`frontend/assetPolicy.ts` is where this stops being advice**: it holds the format rule, the per-image and whole-tree byte budgets and the dimension ratchet as exported constants, and `frontend/assetPolicy.test.ts` checks the served tree against them both ways — an asset nothing references fails as dead weight, and a path named in a comment or in this file fails once the file it names has moved. Change a budget by editing the constant, so the diff says what a visitor now downloads. **Panel art is fetched only by this skin**, through the guard script in `index.html`: its `SKINS`/`DEFAULT` must match `src/skins/registry.ts` and its `PANELS` must match `editor/layoutConfig.ts`, both asserted by that same test file. As static `<link rel="preload">` tags the panels were fetched by all four skins — 1.94 MB of art `barebone` never painted — which no static check can catch, because the references were real; `tests/e2e/test_asset_usage.py` catches it in a browser instead, by comparing what each skin fetched against what it drew
11. Files over 250 lines (TS/TSX/CSS) must be split before commit.
12. **Never link two bubbles across panels** — a tube's two ends share one `panel`, or there is no tube
13. **Never give a panel bubble its own tail path** — the tail is a ring vertex, so `'none'` and a turn both morph
14. **Never hard-code a panel polygon or a gutter offset** — panel shapes come from `PANEL_GRIDS` through `gridPolys`, and the gutter is one perpendicular inset. A polygon written anywhere else stops moving when the grid does, and an offset applied per axis is the wrong width on every diagonal
