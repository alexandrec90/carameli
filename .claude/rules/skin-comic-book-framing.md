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
morph targets, the `linkTo` tube partner and the `chain` this balloon is a slot of;
content may be lettering, a wheel picker, a text input or a locale-formatted phone
input) and the chain settings those names resolve to (`PANEL_BUBBLE_CHAINS`),
plus each panel's background pattern style
(`PANEL_PATTERNS`, the one array parallel to `PANELS`; the per-panel palette and dot
metrics stay in `PANEL_BG_CONFIGS` in `panelPatterns.ts`). The renderer in
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
`chainOps.ts`.

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
four corners (`quad`, in % of the picture's frame), solves the homography carrying the
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

## Dev-only visual editor

| Property | Value | Notes |
| --- | --- | --- |
| Enable / disable | `?edit=1` / `?edit=0` in dev | Flag persists in `localStorage['comic-book:edit']`; `?edit=0` clears it |
| Gate | `import.meta.env.DEV && (?edit=1 \|\| flag)` | Never ships — `?edit=1` is inert in prod |
| Select | click a **panel**, a **picture** or a **bubble** | A picture wins over the panel under it, a bubble over both; a panel is only outlined — it is the slot the **+** buttons add to, and where its background pattern is picked |
| Adjust | drag / wheel / handles / arrows | Move the frame or bubble, resize (bottom-right grip), pan the picture inside its frame (top-left grip, picture only), rotate (top-right grip, bubble only), nudge (⇧×10); for a picture **Alt** swaps the two framings |
| Add / remove | **+ Image** / **+ Bubble** toolbar buttons, **Delete image** / **Delete bubble** in the inspector | Adds to the selected panel; deleting a bubble clears any link naming it |
| Panel fields | inspector select | background **pattern** style (`PATTERN_STYLE_KEYS`; palette stays per panel) |
| Picture fields | inspector selects | panel, picture (`PANEL_ASSETS`), alt (empty = decorative), anchor, spill |
| Bubble fields | inspector selects | panel, type, **tail** (nine options incl. **No tail**), **content** (Text / Wheel picker / Text input / Phone input), authored text or initial value, hover/click morph, **chain** (free text, completing on the names already in use), link |
| Chain fields | inspector, below the bubble's own, when the bubble names a chain | **grow** / **step ms**, **scroll**, **messages** (one per line; empty = speak the balloons' own text), **+ Balloon in chain** — they edit the whole column, not the selected balloon. Chained balloons render flat in edit mode so each stays selectable |
| Table on / off | **Project a table onto this image** checkbox (picture inspector) | Switching on seeds a starter surface; switching off deletes the table and its cells, leaving the picture |
| Table fields | inspector controls | rows visible, text size, ink, headings on/off, the four corner X/Y pairs, **Reset corners**, and a columns list (heading / width weight / alignment) plus the cell text, one row per line, tab- or `\|`-separated |
| Table corners | drag the four **square grips** | Only on the selected picture, only in content mode. The band guides move with them, so align the guides to the ruling in the photograph |
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
