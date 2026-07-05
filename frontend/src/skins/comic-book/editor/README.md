# Comic-Book Visual Layout Editor (dev-only)

A small in-app editor for visually **moving and resizing** the per-panel images and
speech bubbles in the `comic-book` skin, plus an **export** that copies the tuned
numbers back into source.

## Source of truth

[`layoutConfig.ts`](./layoutConfig.ts) holds `PANEL_IMG_TRANSFORMS` and
`PANEL_BUBBLE_TRANSFORMS` — the per-panel image framing (scale / offset / anchor /
spill) and bubble placement **and content** (top / right / width / rotate / spill /
type / text). The bubble `type` resolves to artwork + font via
[`bubbleTypes.ts`](./bubbleTypes.ts) (`BUBBLE_TYPES`). The renderer in `Layout.tsx`
reads everything from these modules — there are no more magic framing numbers, and
no bubble text/art lives in `Layout.tsx`.

## Quick start

1. Run the dev server and open the app with `?edit=1` in the URL
   (e.g. `http://localhost:5173/?edit=1`). The flag persists in `localStorage`
   across client-side navigation; leave edit mode with `?edit=0` (which also
   clears the persisted flag). Toggle back and forth via the URL as needed —
   your unsaved working copy survives the round trip.
2. Click a panel **image** or **bubble** to select it. (In edit mode every bubble
   is shown without hover so it can be selected.)
   - The overlay blocks the panels' own click navigation, so use the **Page**
     dropdown in the toolbar to move between pages (each switch replays the
     Ben-Day wash transition). The **Loading screen** entry previews the loading
     overlay; picking any page again replays its exit wash.
3. Adjust:
   - **Drag** the selection to move.
   - **Drag the bottom-right handle** to zoom (image, in *and* out) / resize (bubble).
   - **Drag the round top-right handle** to rotate (bubble only).
   - **Wheel** over the selection to zoom (image) / resize (bubble).
   - **Arrow keys** nudge (hold **⇧** for ×10); **+/-** zoom/resize; **Esc** deselects.
   - **Allow spill outside panel** checkbox — off (default for images) clips the
     element to the panel polygon (overflow hidden behind the panel edge); on lets it
     bleed into the gutter (default for bubbles).
   - For bubbles: pick a **type** from the dropdown (sets artwork + font) and edit the
     **text** inline.
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
bubbleTypes.ts      BubbleType + BUBBLE_TYPES (artwork/font per type) — ships in prod
layoutConfig.ts     PANEL_IMG_TRANSFORMS, PANEL_BUBBLE_TRANSFORMS — source of truth
transforms.ts       PURE helpers: CSS builders, drag/scale math, clamp, serializeConfig(File)
useEditorMode.ts    hook: flag detection, working copy, persistence, selection
useOverlayInteraction.ts  pointer/wheel/keyboard wiring (thin)
useToolbarDrag.ts   hook: draggable toolbar position (viewport-clamped, persisted)
EditorOverlay.tsx   overlay UI: targets, outline, actions (dev-only, dynamically imported)
InspectorPanel.tsx  selection inspector: read-outs, spill, bubble type/text, per-element reset
PageSelect.tsx      toolbar dropdown: switch page / preview the loading screen
pageSelection.ts    PURE helpers behind PageSelect (sentinel value, selection resolution)
editor.css          overlay chrome styles
```

All math/serialization is pure and unit-tested under
`frontend/src/tests/skins/` (`editorTransformsMath`, `editorMode`, `editorSerialize`,
`pageSelection`, `editorToolbarDrag`).
