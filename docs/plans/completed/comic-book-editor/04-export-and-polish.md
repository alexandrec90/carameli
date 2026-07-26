# Phase 4 — Export, prod-safety guard, docs

**Goal:** Close the loop — let the user copy their tuned values back into source, prove the
editor adds **zero** production cost, and document the workflow so it's discoverable.

## Prereqs

`00-overview.md` + Phases 1–3 merged.

## 1. Export — copy config back to source

Add to `frontend/src/skins/comic-book/editor/transforms.ts` (pure, tested):

```ts
/** Serialize a working EditorConfig into paste-ready TS matching layoutConfig.ts. */
export function serializeConfig(c: EditorConfig): string
```

It must emit code that drops straight into `layoutConfig.ts`, e.g.:

```ts
export const PANEL_IMG_TRANSFORMS: ImgTransform[] = [
  { scale: 1, offsetX: 0, offsetY: -12, anchor: 'center bottom' },
  // ...8 entries
]
export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [
  { top: -35, right: -12, width: 55, rotate: -5 },
  // ...8 entries
]
```

Round numbers sensibly (e.g. scale to 2 decimals, offsets/percent to integers) so the output
is clean. Wire the **Copy config** toolbar button (placeholder since Phase 2) to
`navigator.clipboard.writeText(serializeConfig(api.config))` with a brief "Copied!" confirmation.
Add a secondary **Download .ts** (Blob + anchor) as a fallback when clipboard is unavailable.

Optionally add a **Reset all → defaults** that also clears `localStorage['comic-book:editConfig']`.

## 2. Production-safety guard (verify tree-shaking)

- Confirm `EditorOverlay` and `editor.css` are **not** in the production bundle:
  - `npm run build`, then grep the `dist/assets/*.js` for an overlay-only marker string (e.g.
    a toolbar label like `"Reset all"`). It must be absent.
  - Confirm the dynamic-import chunk for the overlay is not emitted (or is emitted but never
    referenced) when built — because `editor.active` is `false` under
    `import.meta.env.DEV === false`, the branch is dead-code-eliminated.
- `layoutConfig.ts` + `transforms.ts` (data + pure CSS/math) **do** ship — that's correct and tiny.
- Sanity: load the production build with `?edit=1` and confirm the overlay does **not** appear
  (the `import.meta.env.DEV` gate wins).

## 3. Docs & rule update

- Update `.claude/rules/skin-comic-book.md`:
  - Note that `editor/layoutConfig.ts` is the **source of truth** for per-panel image framing
    and bubble placement (no more magic numbers in `Layout.tsx` / CSS for those).
  - Document the editor: enable with `?edit=1` in dev, drag/wheel/handles/arrows to adjust,
    **Copy config**, paste into `layoutConfig.ts`. Dev-only; never ships.
- Add a short `frontend/src/skins/comic-book/editor/README.md` (or a header comment in
  `layoutConfig.ts`) with the same quick-start, so the next dev finds it.
- If a project memory about the editor workflow would help future sessions, write one (see the
  memory guidance) — keep it to the non-obvious bits (flag, export-to-source loop), not what
  the code already shows.

## Tests to add

`frontend/src/tests/skins/editorSerialize.test.ts`:

- `serializeConfig(seedConfig())` produces a string that contains both
  `PANEL_IMG_TRANSFORMS` and `PANEL_BUBBLE_TRANSFORMS`, 8 entries each.
- The emitted string is valid for re-parse: a regex/`Function`-eval round-trip (or simply
  assert the rounded numeric formatting, e.g. no `1.0000000002`).
- Numbers are rounded per the rules above.

Run: `npm test -- editorSerialize`.

## Done-when

- In dev, a full loop works: open `?edit=1` → move/resize image + bubble → **Copy config** →
  paste into `layoutConfig.ts` → reload without `?edit=1` → the change is now the baseline.
- Production build verified clean of editor code; `?edit=1` does nothing in prod.
- Rule file + quick-start doc updated; targeted tests green; `tsc`/build clean; no file > 250 lines.

## Optional follow-ups (not required)

- Per-panel **bubble text/font** editing (currently `PANEL_BUBBLES` in `Layout.tsx`) could fold
  into the same config + editor later.
- Extract the Ben-Day dot renderers out of `Layout.tsx` (still ~1000 lines) into
  `editor/`-adjacent modules to bring `Layout.tsx` under the 250-line rule — separate cleanup.
