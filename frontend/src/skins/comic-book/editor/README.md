# Comic-Book Visual Layout Editor (dev-only)

A small in-app editor for visually **placing, framing and resizing** the pictures and
speech bubbles in the `comic-book` skin, plus an **export** that copies the tuned
numbers back into source.

## Source of truth

[`layoutConfig.ts`](./layoutConfig.ts) holds `PANEL_IMG_TRANSFORMS` and
`PANEL_BUBBLE_TRANSFORMS` — picture placement **and content** (panel / src / alt /
left / top / width / spill) and bubble
placement **and content** (panel / top / right / width / rotate / spill / type / tail /
text), plus each bubble's event morph targets (`hoverType`, `clickType`) and its
connector-tube partner (`linkTo`). A picture's `src` is a public URL, offered in the
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

**A picture's frame is the picture, and it has no height.** `left`/`top`/`width` are
its rectangle over the panel box, in % of that box — where the picture sits and how big
it renders, exactly as a bubble's `top`/`right`/`width` is. The height is not authored:
it is the width divided by the *source's* own aspect ratio (`imgAspect`, from the
natural size captured on load), precisely as a bubble's height follows `BUBBLE_ASPECT`.
So the frame is the picture's true outline — it can be moved and resized, never
reshaped, and nothing it does can crop the source.

The frame is geometry and nothing else. It draws no ink and cuts no shape: while
`spill` is off the *panel* crops the picture (`imgPanelClip`, the panel polygon at true
size, offset onto the frame's origin), and while it is on nothing does — which is a
bubble's rule, unchanged.

There were briefly four more fields — an authored `height`, plus `scale`/`offsetX`/
`offsetY`/`anchor` framing the picture *inside* that box. They existed to choose which
part of a picture survived being forced into a box of the wrong shape, and every shape
but one crops: with one authored height per panel the eight shipped pictures showed
between 38% and 98% of their source, no two framed alike, and the editor's selection
outline was the crop window rather than the picture. Nothing is forced now, so there is
nothing left to choose. Before that, the frame was the panel polygon itself, so
dragging could only slide the picture under a window that stayed put and a second
picture on the same panel had nowhere to go.

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
   to; a panel has nothing to drag, so it is only outlined.
   - The overlay blocks the panels' own click navigation, so use the **Page**
     dropdown in the toolbar to move between pages (each switch replays the
     Ben-Day wash transition). The **Loading screen** entry previews the loading
     overlay; picking any page again replays its exit wash.
3. Adjust:
   - **Drag** the selection to move the frame (picture) / the bubble.
   - **Drag the bottom-right handle** to resize the frame (picture) / the bubble.
     Only the horizontal component counts for a picture: its height follows the source,
     so the picture keeps its proportions and cannot be squashed.
   - **Drag the round top-right handle** to rotate (bubble only).
   - **Wheel** over the selection to resize it.
   - **Arrow keys** nudge (hold **⇧** for ×10); **+/-** resize; **Del** deletes;
     **Esc** deselects. The same set for a picture and a bubble — they are the same
     kind of thing on a panel.
   - For pictures: pick the **panel** it belongs to, the **picture** it draws (from
     `PANEL_ASSETS`), and its **alt** text — empty marks it decorative. There is no
     anchor, because there is nothing to anchor: a frame is built to its source's
     ratio, so the whole picture is always in shot.
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

**Copy config** / **.ts** remain as fallbacks: Copy puts the two paste-ready
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
layoutConfig.ts     PANEL_IMG_TRANSFORMS, PANEL_BUBBLE_TRANSFORMS — source of truth
configOps.ts        PURE config edits: seed/hydrate/patch, add/remove picture or bubble, link sanitation
serialize.ts        PURE serialization back to layoutConfig.ts (headers included)
transforms.ts       PURE helpers: CSS builders, frame/drag/size math, source aspect, clamp
useEditorMode.ts    hook: flag detection, working copy, persistence, selection
useOverlayInteraction.ts  pointer/wheel/keyboard wiring (thin)
useToolbarDrag.ts   hook: draggable toolbar position (viewport-clamped, persisted)
EditorOverlay.tsx   overlay UI: targets, outline, + Image / + Bubble, actions (dev-only, dynamically imported)
InspectorPanel.tsx  selection inspector: read-outs, spill, per-element reset, delete
ImageInspector.tsx  picture-only controls: panel, picture, alt
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
