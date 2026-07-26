# Phase 2 — Editor mode + overlay scaffold

**Goal:** Add the dev-only editor *state* and a *non-interactive* overlay: it detects the
flag, holds a working copy of the config (seeded from `layoutConfig.ts`, persisted to
`localStorage`), lets you **select** a target (an image or a bubble), shows its **live numeric
values**, and offers **reset**. **No drag/resize yet** — that is Phase 3.

## Prereqs

`00-overview.md` + Phase 1 merged (config, `transforms.ts`, refactored renderer).

## Files to create

### 1. `frontend/src/skins/comic-book/editor/useEditorMode.ts`

A skin-local hook (allowed; only *views* are forbidden from holding state). Responsibilities:

- **Flag detection:** active when `import.meta.env.DEV` AND (`new URLSearchParams(location.search).get('edit') === '1'` OR `localStorage.getItem('comic-book:edit') === '1'`). Setting `?edit=1` also writes the localStorage flag so it survives navigation.
- **Working copy state:** `EditorConfig` seeded from `PANEL_IMG_TRANSFORMS` / `PANEL_BUBBLE_TRANSFORMS`, deep-cloned. On mount, hydrate from `localStorage['comic-book:editConfig']` if present (else seed from constants).
- **Persistence:** every change writes the working copy to `localStorage['comic-book:editConfig']` (debounce optional; not required).
- **Selection:** `selected: { kind: 'img' | 'bubble'; index: number } | null` with `select(kind, index)` and `clear()`.
- **Mutators (used by Phase 3, define now):** `setImg(index, partial: Partial<ImgTransform>)`, `setBubble(index, partial)`, `resetOne(kind, index)` (restore that entry to the constant default), `resetAll()`.
- **Return shape:**

```ts
export interface EditorModeApi {
  active: boolean
  config: EditorConfig
  selected: { kind: 'img' | 'bubble'; index: number } | null
  select(kind: 'img' | 'bubble', index: number): void
  clear(): void
  setImg(index: number, patch: Partial<ImgTransform>): void
  setBubble(index: number, patch: Partial<BubbleTransform>): void
  resetOne(kind: 'img' | 'bubble', index: number): void
  resetAll(): void
}
```

Keep all non-React serialization/clone/seed/hydrate logic as **exported pure functions**
(`seedConfig()`, `cloneConfig(c)`, `hydrateConfig(raw: string | null): EditorConfig`) so they
can be unit-tested without rendering.

### 2. `frontend/src/skins/comic-book/editor/EditorOverlay.tsx`

Dev-only overlay component. Receives `api: EditorModeApi` plus the current `panelPolys`
(so it can position selection outlines over each panel's `bounds`). For this phase:

- Render an absolutely-positioned, high-`z-index` layer above `cb-root` content.
- For each panel `i`, render a transparent click target over `bounds` that calls
  `api.select('img', i)`; and a small click target over the bubble region that selects the
  bubble. (Reuse `poly.bounds` from `Layout`.) A click on empty space calls `api.clear()`.
- Draw a selection outline around the selected target.
- Render a **toolbar** (fixed corner) showing: the selected target label (e.g. "Panel 3 image"),
  its live numeric values (scale/offset or top/right/width/rotate), a **Reset** button
  (`resetOne`), a **Reset all** button, and a placeholder **Copy config** button (wired in
  Phase 4). No editing inputs needed yet — values are read-only here.
- Toolbar/handles use neutral dev styling from `editor.css`, visually distinct from comic art.

### 3. `frontend/src/skins/comic-book/editor/editor.css`

Overlay layer, selection outline, handle, and toolbar styles. Plain/neutral styling is fine
(this is dev chrome, exempt from the comic palette). Keep < 250 lines.

## Files to modify

### 4. `frontend/src/skins/comic-book/Layout.tsx`

- Call `const editor = useEditorMode()` near the top.
- Source transforms from the editor working copy when active, else the constants:
  `const imgT = editor.active ? editor.config.images : PANEL_IMG_TRANSFORMS` (same for bubbles).
  Pass `imgT[i]` / `bubbleT[i]` into `imgTransformStyle` / `bubbleStyle` in the panel map.
- **Dynamically import** the overlay so prod never bundles it:

```tsx
const EditorOverlay = editor.active
  ? lazy(() => import('./editor/EditorOverlay'))
  : null
// ...in JSX, after cb-root content:
{EditorOverlay && (
  <Suspense fallback={null}>
    <EditorOverlay api={editor} panelPolys={panelPolys} />
  </Suspense>
)}
```

Guard the `import()` behind `editor.active` (which already includes `import.meta.env.DEV`), so
Rollup drops the chunk from production. Verify in Phase 4.

## Tests to add

`frontend/src/tests/skins/editorMode.test.ts` (pure-function level):

- `seedConfig()` returns length-8 arrays equal to the constants (deep, not by reference).
- `hydrateConfig(null)` falls back to seed; `hydrateConfig(JSON.stringify(seedConfig()))`
  round-trips; `hydrateConfig('not json')` falls back to seed without throwing.
- A reducer-style test for `setImg`/`setBubble` patch-merge and `resetOne` restoring defaults,
  if those are extracted as pure helpers (recommended).

Optionally, a light `@testing-library/react` test: render `EditorOverlay` with a stub `api`,
click a panel target, assert `select` was called with the right index.

Run: `npm test -- editorMode`.

## Done-when

- Visiting `/?edit=1` in dev shows the overlay + toolbar; selecting a panel shows its live
  values; Reset works; production build (no `?edit=1`) is unchanged and does not bundle the overlay.
- Targeted tests green; `tsc`/build clean; no file > 250 lines.
