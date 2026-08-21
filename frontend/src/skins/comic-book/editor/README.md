# Comic-Book Visual Layout Editor (dev-only)

A small in-app editor for visually **placing, framing and resizing** the pictures and
speech bubbles in the `comic-book` skin, plus an **export** that copies the tuned
numbers back into source.

## Source of truth

[`layoutConfig.ts`](./layoutConfig.ts) holds `PANEL_IMG_TRANSFORMS` and
`PANEL_BUBBLE_TRANSFORMS` — picture placement **and content** (panel / src / alt /
left / top / width / height / scale / offsetX / offsetY / anchor / spill) and bubble
placement **and content** (panel / top / right / width / rotate / spill / type / tail /
text), plus each bubble's event morph targets (`hoverType`, `clickType`) and its
connector-tube partner (`linkTo`). It also holds `PANEL_PATTERNS` — each panel's
Ben-Day background style, the one array here that **is** parallel to `PANELS`; the
per-panel palette and dot metrics stay tuned in
[`../panelPatterns.ts`](../panelPatterns.ts) (`PANEL_BG_CONFIGS`), so switching a
panel's pattern keeps its colors. A picture's `src` is a public URL, offered in the
editor by the static manifest in [`assets.ts`](./assets.ts) (`PANEL_ASSETS`). The
bubble `type` resolves to a lettering font via [`bubbleTypes.ts`](./bubbleTypes.ts)
(`BUBBLE_TYPES`); the outline itself is generated vector geometry in
[`../bubbleShape.ts`](../bubbleShape.ts). The renderer reads everything from these
modules — there are no more magic framing numbers, and no bubble text lives in
`Layout.tsx`.

**Neither array is parallel to the panels.** A picture and a bubble alike name their
own `panel`, so a panel may own several of each or none, and each array's length is the
author's. `panel` is the whole association: placement is measured against that panel's
box, and hovering that panel is what reveals its bubbles. A `linkTo` partner must sit on
the **same panel** — the editor only offers same-panel partners, and the renderer drops
any cross-panel link it is handed, because half a tube appearing on a different hover
cannot read as one utterance.

**A picture has two independent framings, which is why it has so many fields.**
`left`/`top`/`width`/`height` are the *frame*: its own rectangle over the panel box, in
% of that box, cut to the panel's polygon scaled into it (`imgFramePoly`). A picture
left at the default `0/0/100/100` therefore crops exactly as a panel image always did,
and an inset one reads as a small comic panel rather than a rectangle pasted on top.
`scale`/`offsetX`/`offsetY`/`anchor` are the second framing: they move the picture
*inside* that frame. Before pictures became entities the frame was the panel polygon
itself, so dragging could only slide the picture under a window that stayed put, and a
second picture on the same panel had nowhere to go.

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
2. Click a **panel**, a **picture** or a **bubble** to select it. (In edit mode every
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
3. Adjust:
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
   - **Allow spill outside panel** checkbox — off (default for pictures) clips the
     element to the frame's polygon (overflow hidden behind its edge); on lets it
     bleed past (default for bubbles).
   - For bubbles: pick the **panel** it belongs to, a resting **type** (sets shape +
     lettering font), which way the **tail** points (**No tail** is one of the nine
     options), edit the **text** inline, choose the shapes to morph to **on hover**
     and **on click** (`— no change —` keeps the resting shape), and pick a **link
     to** partner to join with a connector tube. Turning or removing a tail morphs
     like any other shape change, because the tail is one ring vertex pulled out.
     The tube redraws live as you drag either end; two bubbles that overlap draw no
     tube at all, so drag them apart if one doesn't appear. Links are symmetric —
     declare it at one end only — and the **link to** dropdown lists only the other
     bubbles on the same panel (it is disabled when there are none). Changing a
     bubble's panel clears a link that would have crossed one.
   - **+ Image** / **+ Bubble** (toolbar) append a new picture or bubble to the
     selected panel — select the panel, a picture on it or a bubble on it first, so
     there is a panel to add to — and select what they added. **Delete image** /
     **Delete bubble** (inspector) removes the selected one; deleting a bubble also
     clears any link that named it. **Reset** restores a shipped element to its
     default; one you added has no default, so reset leaves it alone.
   - The toolbar is **draggable by its COMIC EDITOR title bar** — move it off any
     panel it covers. The position is clamped to the viewport and persists in
     `localStorage` across reloads.
4. Click **Save** to write the change straight back to `layoutConfig.ts` (a dev-only
   Vite endpoint, `POST /__comic-editor/save`); HMR reloads it. **Reset** discards
   unsaved edits and reverts to the last saved file.
5. Reload **without** `?edit=1` — your saved change is now the baseline.

**Copy config** / **.ts** remain as fallbacks: Copy puts the three paste-ready
`export const` blocks on the clipboard; **.ts** downloads a complete `layoutConfig.ts`.
Both are used automatically if the Save endpoint or clipboard is unavailable.

## Dev-only / zero prod cost

The editor is gated behind `import.meta.env.DEV && (?edit=1 OR localStorage flag)`.
`EditorOverlay.tsx` is pulled in via dynamic `import()` behind an
`import.meta.env.DEV` check, so Rollup tree-shakes it (and `editor.css`) out of the
production bundle. Only `layoutConfig.ts` (data), `bubbleTypes.ts` (data), and
`transforms.ts` (pure CSS/math the renderer needs) ship in prod — all tiny. The Save
endpoint lives only in the dev server (Vite `apply: 'serve'`). `?edit=1` does nothing
in a prod build.

## Layout

```text
types.ts            ImgTransform, BubbleTransform, EditorConfig
assets.ts           PANEL_ASSETS: the pictures a frame may point at (static manifest)
bubbleTypes.ts      BubbleType + BUBBLE_TYPES (lettering font per type) — ships in prod
../panels.ts        PANELS: the grid slots — label, isLogo, route (what `panel` indexes)
../PanelImages.tsx  one panel's pictures: filters the array by panel, frames and clips each
../bubbleBox.ts     PURE authoring box: viewBox, base ellipse, TAIL_DIRS + tail geometry
../bubbleShape.ts   PURE outline geometry: the shared vertex ring, per-type modulation, morph lerp
../bubbleTube.ts    PURE connector-tube geometry + link/reveal semantics
../useBubbleMorph.ts  rAF morph driver — writes `d` to the DOM, not through React
../PanelBubble.tsx  one bubble: outline SVG + text + hover/press morph state
../PanelBubbles.tsx one panel's bubbles: filters the array by panel, clips the non-spilling ones
../BubbleTubes.tsx  viewport-level tube layer for every linked pair
../panelPatterns.ts pattern style registry + per-panel palette/dot tuning (PANEL_BG_CONFIGS)
layoutConfig.ts     PANEL_IMG_TRANSFORMS, PANEL_BUBBLE_TRANSFORMS, PANEL_PATTERNS — source of truth
configOps.ts        PURE config edits: seed/patch, add/remove picture or bubble, pattern switch, link sanitation
configHydrate.ts    PURE rebuild from a persisted payload: backfill, enum coercion, pattern fallback
serialize.ts        PURE serialization back to layoutConfig.ts (headers included)
transforms.ts       PURE helpers: CSS builders, frame/drag/scale math, clamp
useEditorMode.ts    hook: flag detection, working copy, persistence, selection
useOverlayInteraction.ts  pointer/wheel/keyboard wiring (thin)
useToolbarDrag.ts   hook: draggable toolbar position (viewport-clamped, persisted)
EditorOverlay.tsx   overlay UI: targets, outline, + Image / + Bubble, actions (dev-only, dynamically imported)
InspectorPanel.tsx  selection inspector: read-outs, spill, per-element reset, delete
ImageInspector.tsx  picture-only controls: panel, picture, alt, anchor
BubbleInspector.tsx bubble-only controls: panel, type, tail, text, hover/click, link
PageSelect.tsx      toolbar dropdown: switch page / preview the loading screen
pageSelection.ts    PURE helpers behind PageSelect (sentinel value, selection resolution)
editor.css          overlay chrome styles
```

Save overwrites `layoutConfig.ts` **verbatim** with what `serialize.ts` emits, so
anything that module does not write is deleted on the first save. That is why the
file's explanatory comments live in `serialize.ts` as headers, and why nothing else
(a `NEW_IMAGE` or `NEW_BUBBLE` default, a helper) may live in `layoutConfig.ts`.
`editorSerialize` asserts the round trip byte for byte, so a header edited in one file
and not the other fails there rather than on the first save.

All math/serialization is pure and unit-tested under
`frontend/src/tests/skins/` (`comicBookTransforms`, `editorTransformsMath`,
`editorMode`, `editorConfigOps`, `editorSerialize`, `pageSelection`,
`editorToolbarDrag`, `bubbleShape`, `bubbleTube`).
