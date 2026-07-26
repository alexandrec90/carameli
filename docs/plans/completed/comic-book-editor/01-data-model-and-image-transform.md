# Phase 1 — Data model + image/bubble rendering refactor

**Goal:** Introduce the source-of-truth config and refactor `Layout.tsx` to render images and
bubbles from it. **No editor UI in this phase.** The app must look identical afterward
(see the visual-parity contract in `00-overview.md`).

This phase is shippable on its own and de-risks everything after it.

## Prereqs

Read `00-overview.md` (architecture decisions + rendering model + parity contract).

## Files to create

### 1. `frontend/src/skins/comic-book/editor/types.ts`

```ts
/** Per-panel image framing, relative to the panel box. Layout-independent. */
export interface ImgTransform {
  /** Zoom factor applied via CSS transform: scale(). 1 = fill (objectFit cover). */
  scale: number
  /** Horizontal pan in px (CSS transform: translateX). */
  offsetX: number
  /** Vertical pan in px (CSS transform: translateY). */
  offsetY: number
  /** CSS object-position base anchor, e.g. 'center bottom'. */
  anchor: string
}

/** Per-panel speech-bubble placement, in % of the panel box (matches today's CSS). */
export interface BubbleTransform {
  /** top offset in %, may be negative (bubble floats above panel). */
  top: number
  /** right offset in %, may be negative. */
  right: number
  /** bubble width in % of panel width. */
  width: number
  /** rotation in degrees. */
  rotate: number
}

export interface EditorConfig {
  images: ImgTransform[]   // length 8, parallel to PANEL_IMAGES
  bubbles: BubbleTransform[] // length 8, parallel to PANEL_BUBBLES
}
```

### 2. `frontend/src/skins/comic-book/editor/layoutConfig.ts`

The source of truth. Defaults reproduce today's look exactly (parity contract).

```ts
import type { ImgTransform, BubbleTransform } from './types'

// Index parallel to PANEL_IMAGES in Layout.tsx. P0 is the logo.
export const PANEL_IMG_TRANSFORMS: ImgTransform[] = [
  { scale: 1, offsetX: 0, offsetY: 0, anchor: 'center center' }, // 0 logo
  ...Array.from({ length: 7 }, () => (
    { scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom' }
  )),
]

// Index parallel to PANEL_BUBBLES. Defaults = today's .cb-panel-bubble CSS.
export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] =
  Array.from({ length: 8 }, () => ({ top: -35, right: -12, width: 55, rotate: -5 }))
```

> The implementing agent must confirm the logo is index 0 and only the logo used
> `objectPosition: 'center center'` (see `Layout.tsx` — `info.isLogo ? 'center center' : 'center bottom'`). Keep that exact split.

### 3. `frontend/src/skins/comic-book/editor/transforms.ts` (pure, tested)

```ts
import type { ImgTransform, BubbleTransform } from './types'

/** CSS for the <img> inside the clip wrapper. */
export function imgTransformStyle(t: ImgTransform): React.CSSProperties {
  return {
    objectFit: 'cover',
    objectPosition: t.anchor,
    transform: `translate(${t.offsetX}px, ${t.offsetY}px) scale(${t.scale})`,
    transformOrigin: 'center center',
  }
}

/** Inline style for the .cb-panel-bubble wrapper (overrides the CSS defaults). */
export function bubbleStyle(b: BubbleTransform): React.CSSProperties {
  return { top: `${b.top}%`, right: `${b.right}%`, width: `${b.width}%` }
  // NOTE: rotate is applied via the existing transform on .cb-panel-bubble (see CSS note below).
}
```

(Drag/scale/clamp/serialize helpers are added in later phases — keep this file focused on
read-only CSS builders for now, but create it here so the renderer imports from one place.)

## Files to modify

### 4. `frontend/src/skins/comic-book/Layout.tsx`

In the panel `.map(...)`:

- Wrap the `<img>` in a new clip wrapper div (`className="cb-img-clip"`) that carries
  `overflow: hidden` and the existing `clip-path` (`dotClip`). The img no longer needs its own
  `clipPath`. The dots canvas keeps its own `clipPath` (unchanged).
- Drive the img with `imgTransformStyle(PANEL_IMG_TRANSFORMS[i])` instead of the inline
  `objectFit`/`objectPosition`. Keep `width: bounds.w`, `height: bounds.h`, `position:absolute`,
  `left/top:0`, `opacity: imgsVisible ? 1 : 0`, `onLoad`/`onError` exactly as-is.
- Drive the bubble wrapper with `style={bubbleStyle(PANEL_BUBBLE_TRANSFORMS[i])}` merged with
  whatever the element needs.
- **Important:** the panel div stays `overflow: visible` so the bubble can spill. Only the new
  `.cb-img-clip` wrapper is `overflow: hidden`.

### 5. `frontend/src/skins/comic-book/comic-book.css`

- Add `.cb-img-clip { position:absolute; inset:0; overflow:hidden; }` (clip-path supplied inline).
- The `.cb-panel-bubble` rule keeps `transform: scale(...) rotate(-5deg)` for the hover spring,
  but `top/right/width` move to inline style. To keep the per-panel `rotate` data-driven while
  preserving the hover scale animation, set rotate via a CSS custom property:
  - In CSS: `.cb-panel-bubble { transform: scale(0.7) rotate(var(--cb-bubble-rot, -5deg)); }`
    and `.cb-panel:hover .cb-panel-bubble { transform: scale(1) rotate(var(--cb-bubble-rot, -5deg)); }`.
  - In `bubbleStyle`, also return `['--cb-bubble-rot' as any]:`${b.rotate}deg``.
- Remove the now-duplicated `top/right/width` literals from `.cb-panel-bubble` (or leave them as
  fallbacks — inline style wins regardless).

## Tests to add

`frontend/src/tests/skins/comicBookTransforms.test.ts`:

- `imgTransformStyle` returns expected `transform`, `objectFit`, `objectPosition` for a sample.
- Default config parity: `PANEL_IMG_TRANSFORMS[0].anchor === 'center center'`; all others
  `'center bottom'`; every entry `scale:1, offsetX:0, offsetY:0`.
- `bubbleStyle` maps `{top,right,width,rotate}` → `'-35%'`, `'-12%'`, `'55%'`, `--cb-bubble-rot:'-5deg'`.
- `PANEL_BUBBLE_TRANSFORMS` and `PANEL_IMG_TRANSFORMS` both have length 8 (matches panel count).

Run: `npm test -- comicBookTransforms`.

## Done-when

- App renders identically to before at landscape/portrait/square (eyeball or Playwright MCP
  screenshot diff).
- `tsc` + `vite build` clean; targeted tests green.
- No new file exceeds 250 lines.
