# Comic-Book Visual Layout Editor — Implementation Plan

A dev-only, in-app editor for visually **moving and resizing** the panel images and
speech bubbles in the `comic-book` skin, plus an **export** that copies the resulting
numbers back into source.

This `00-overview.md` is shared context. Phases `01`–`04` are each scoped to a single
coding-agent session and can be executed in order. Each phase file is self-contained but
assumes this overview was read first.

---

## Why this exists (the core problem)

Today there is **no single source of truth** for where/how big things are:

- **Panels** — magic numbers inside `computeLandscapeLayout` / `computePortraitLayout` /
  `computeSquareLayout` in `frontend/src/skins/comic-book/Layout.tsx`.
- **Images within a panel** — `objectFit: 'cover'` + a hard-coded `objectPosition` string
  (`Layout.tsx`, in the panel `.map(...)`). There is currently **no way to zoom** an image —
  `cover` just fills the box.
- **Bubbles** — one shared CSS rule (`.cb-panel-bubble` in `comic-book.css`: `top:-35%;
  right:-12%; width:55%`) applies to *every* panel identically.

Every tweak means editing a number → save → reload → eyeball. The plan turns those numbers
into **data**, then puts a **visual editor on top of that data**, with an **export** back to source.

**Scope of this plan:** images and bubbles only. Re-arranging the *panel polygons*
themselves (the `compute*Layout` math) is explicitly **out of scope** — it is a much larger,
responsive-geometry problem. The editor manipulates each image/bubble *relative to its panel
box*, so its values are resolution- and layout-independent and work across all three layouts.

---

## Architecture decisions (apply to all phases)

1. **New code lives in a new `editor/` folder**, never inside `Layout.tsx` (already 1037
   lines; skin rule #11 caps files at 250). Target layout:

   ```text
   frontend/src/skins/comic-book/editor/
     types.ts          # ImgTransform, BubbleTransform, EditorConfig
     layoutConfig.ts   # PANEL_IMG_TRANSFORMS, PANEL_BUBBLE_TRANSFORMS — the source of truth
     transforms.ts     # PURE helpers: CSS builders, drag/scale math, clamp, serialize
     useEditorMode.ts  # hook: flag detection, working copy, persistence, selection
     EditorOverlay.tsx # overlay UI (dev-only, dynamically imported)
     editor.css        # overlay styles (selection outlines, handles, toolbar)
   ```

2. **Source of truth = `layoutConfig.ts`.** At runtime the renderer reads transforms from
   this module. When the editor is active, it reads from a **working copy** in
   `useEditorMode` (seeded from `layoutConfig.ts`, persisted to `localStorage`). Export writes
   the working copy back into the format of `layoutConfig.ts` for a human to paste.

3. **Transforms are panel-relative and layout-independent.** Keyed by panel index `0..7`
   (parallel to `PANEL_IMAGES` / `PANEL_BUBBLES`). Image offsets are in **px at the transform
   layer** but the model also carries a percentage-friendly `anchor`; bubble offsets are in
   **%** (matching today's CSS). This means one config works for landscape/portrait/square.

4. **All math is pure and unit-tested.** DOM/pointer wiring in `EditorOverlay.tsx` stays thin;
   every "px delta → new transform", clamp, and serialize function lives in `transforms.ts`
   and is covered by Vitest. This satisfies the repo's same-commit testing rule without
   testing the DOM drag plumbing directly.

5. **Dev-only, zero prod cost.** The editor is gated behind
   `import.meta.env.DEV && (URL has`?edit=1`OR localStorage flag)`. `EditorOverlay.tsx` is
   pulled in via **dynamic `import()`** so Rollup tree-shakes it (and `editor.css`) out of the
   production bundle. `layoutConfig.ts` / `transforms.ts` (tiny, data + pure fns) ship in prod
   because the renderer needs them.

6. **Respect the skin rules** (`.claude/rules/skin-comic-book.md`): no border-radius on
   comic elements, canvas2D + DOM only (no Three/R3F), Bangers/Comic Neue fonts. The editor
   **chrome** (handles, toolbar) is dev tooling and may use neutral styling, but must be
   visually distinct from comic content and never ship to prod.

---

## Visual-parity contract (must hold after Phase 1)

Phase 1 refactors rendering but **must not change how the app looks** with default config.
Before/after the refactor, with default transforms, each panel image and bubble must render
pixel-identically (or within sub-pixel rounding) in all three layouts. The defaults in
`layoutConfig.ts` are chosen to reproduce today's values:

- Image: `scale: 1, offsetX: 0, offsetY: 0, anchor:` `'center center'` for the logo
  (`isLogo`) and `'center bottom'` for all others (today's `objectPosition`).
- Bubble: `top: -35, right: -12, width: 55, rotate: -5` (today's CSS percentages/degrees).

Use the Playwright MCP (`browser_navigate` + `browser_take_screenshot`) before and after
Phase 1 to confirm parity at landscape, portrait, and square widths if desired.

---

## Rendering model for images (introduced in Phase 1)

The panel `<div>` stays `overflow: visible` (bubbles must spill into gutters). Images get a
new **clip wrapper** so zoom/pan can overflow the polygon and be clipped:

```text
.cb-panel (position:absolute, overflow:visible)         ← existing, holds bubble sibling
  └─ .cb-img-clip (position:absolute; inset:0;          ← NEW wrapper
        overflow:hidden; clip-path: <panel polygon>)
        └─ <img .cb-panel-img>                          ← objectFit:cover + objectPosition:anchor
              style: transform: translate(offsetX,offsetY) scale(scale)
  └─ canvas.cb-dots-panel-canvas (clip-path: polygon)   ← unchanged
  └─ .cb-panel-bubble (sibling, may overflow)           ← offsets now from BubbleTransform
```

At `scale:1 / offset:0` this is visually identical to today's `objectFit:cover` +
`objectPosition`. `scale>1` zooms; `offsetX/Y` pans; the wrapper's `clip-path` keeps it inside
the panel shape.

---

## Test & tooling notes

- Test runner: **Vitest + happy-dom + @testing-library/react** (see `frontend/vite.config.ts`,
  tests in `frontend/src/tests/`). Run targeted: `npm test -- transforms` etc.
- Verify with `tsc`/`vite build` for tree-shaking; `npm run lint` if present.
- The skin rule "files over 250 lines must be split" applies to every new file — keep
  `EditorOverlay.tsx` lean by pushing logic into `transforms.ts`/`useEditorMode.ts`.

## Phase index

- `01-data-model-and-image-transform.md` — config module + image/bubble rendering refactor (no editor UI yet). Ships safely on its own.
- `02-editor-mode-and-overlay-scaffold.md` — `useEditorMode` hook + overlay scaffold (selection, toolbar, live values). No drag yet.
- `03-direct-manipulation.md` — drag-to-move, wheel/handle-to-resize, keyboard nudges.
- `04-export-and-polish.md` — copy-to-clipboard export, prod tree-shaking guard, docs/rule update.
