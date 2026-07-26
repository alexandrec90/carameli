# Phase 3 — Direct manipulation (drag-move, resize, keyboard)

**Goal:** Make the selected image/bubble editable by **dragging** (move), **wheel or corner
handles** (resize/zoom), and **arrow keys** (nudge). All the geometry is pure and tested; the
overlay only wires pointer/keyboard events to those helpers and to `useEditorMode` mutators.

## Prereqs

`00-overview.md` + Phases 1–2 merged (`useEditorMode`, `EditorOverlay`, `transforms.ts`).

## Pure helpers to add — `frontend/src/skins/comic-book/editor/transforms.ts`

Add and export (all pure, no DOM):

```ts
export const IMG_SCALE = { min: 1, max: 4, step: 0.05 }     // scale never < 1 (cover must stay filled)
export const BUBBLE_W   = { min: 15, max: 90, step: 1 }     // % of panel width
export const ROTATE     = { min: -30, max: 30 }

export function clamp(v: number, min: number, max: number): number

/** Apply a pointer drag (px delta in viewport space) to an image transform. */
export function dragImg(t: ImgTransform, dxPx: number, dyPx: number): ImgTransform
//  → { ...t, offsetX: t.offsetX + dxPx, offsetY: t.offsetY + dyPx }

/** Zoom an image around its centre by a wheel/handle delta, clamped to IMG_SCALE. */
export function scaleImg(t: ImgTransform, deltaScale: number): ImgTransform
//  → { ...t, scale: clamp(t.scale + deltaScale, IMG_SCALE.min, IMG_SCALE.max) }

/** Drag a bubble: px delta → % of the panel box (needs panel w/h to convert). */
export function dragBubble(b: BubbleTransform, dxPx: number, dyPx: number, panelW: number, panelH: number): BubbleTransform
//  right moves opposite to dx (right offset grows as you drag left): right -= dx/panelW*100; top += dy/panelH*100

/** Resize a bubble by a px handle delta → width %, clamped. */
export function resizeBubble(b: BubbleTransform, dWidthPx: number, panelW: number): BubbleTransform

export function rotateBubble(b: BubbleTransform, deltaDeg: number): BubbleTransform // clamped to ROTATE
```

> Keep the px→% conversions in these helpers (they take `panelW/panelH`), so the overlay never
> does arithmetic inline. This is what the tests target.

If `transforms.ts` approaches 250 lines, split the math into `transforms.math.ts` and keep CSS
builders in `transforms.ts`.

## Overlay wiring — `frontend/src/skins/comic-book/editor/EditorOverlay.tsx`

For the **selected** target only, add interaction (use Pointer Events, not mouse, for trackpad
support):

- **Move:** `onPointerDown` on the selection body captures the pointer
  (`setPointerCapture`), records start client X/Y, and on `pointermove` computes the px delta
  since last move and calls `api.setImg(i, dragImg(current, dx, dy))` (or `dragBubble` with the
  panel's `bounds.w/h` from `panelPolys[i]`). Release on `pointerup`.
- **Resize/zoom:**
  - Image: `onWheel` on the selection → `api.setImg(i, scaleImg(current, -e.deltaY * 0.001))`;
    plus a corner **handle** element whose drag maps its diagonal px delta to a scale delta.
  - Bubble: a corner **handle** → `resizeBubble`; optional rotate handle → `rotateBubble`.
- **Keyboard (when something is selected):** arrow keys nudge offset/position by 1px
  (Shift = 10px); `+`/`-` adjust scale (image) or width (bubble) by the helper `step`; `Esc`
  calls `api.clear()`. Attach to a focused overlay container; `preventDefault` so the page
  doesn't scroll.
- Show live values updating in the toolbar (already rendered in Phase 2).

Keep handler bodies to: read current transform from `api.config`, call a pure helper, pass the
result to `api.setImg/setBubble`. No math in JSX.

## Cross-layout note

Because transforms are panel-relative, the same config value behaves correctly across
landscape/portrait/square. Image offsets are px at the transform layer (consistent regardless
of panel size — acceptable for fine framing); bubble offsets are %, converted from px drag
using the *current* panel `bounds`, so dragging feels 1:1 at any size.

## Tests to add

`frontend/src/tests/skins/editorTransformsMath.test.ts`:

- `clamp` boundaries.
- `dragImg` adds deltas; `scaleImg` clamps at min 1 and max 4; `scaleImg` step accumulation.
- `dragBubble`: a `+10px` x-drag with `panelW=200` reduces `right` by 5 (%) ; y-drag increases
  `top` correctly; `resizeBubble` clamps to `BUBBLE_W`.
- `rotateBubble` clamps to ±30.

Run: `npm test -- editorTransformsMath`.

> The pointer/keyboard DOM plumbing does not need direct tests (it is a thin pass-through);
> the math it calls is fully covered. A single smoke test that a `pointerdown`+`pointermove`
> on the overlay calls `api.setImg` is a nice-to-have.

## Done-when

- In dev `/?edit=1`: select an image → drag to move, wheel/handle to zoom; select a bubble →
  drag to move, handle to resize/rotate; arrows nudge; Esc deselects. Values persist across a
  refresh (localStorage from Phase 2).
- Targeted tests green; `tsc`/build clean; no file > 250 lines.
