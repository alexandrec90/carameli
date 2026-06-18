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

**Renderer:** React DOM + Canvas 2D (for Ben-Day dots, panel lines, misregistration overlays)
**Animation:** CSS `@keyframes` + `requestAnimationFrame` canvas loops (no spring libraries)
**Assets:** `<img>` tags pointing to Gemini-generated PNGs in `public/comic-book/` — desaturated via CSS `filter: grayscale(1)` at rest, re-colorized on hover via CSS custom-property driven `filter: sepia(1) saturate(X) hue-rotate(Ydeg)`
**Page transitions:** misregistration effect — CMYK color mask canvases (C, M, Y, K layers) drift apart as the outgoing page fades out, collapse back as the incoming page fades in
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

Views must tile their content inside the panel regions defined by the canvas lines. Use `position: absolute` panels over the canvas. Exact coordinates are computed at runtime from `window.innerWidth / innerHeight`.

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

### Asset Image (Gemini-generated)

```tsx
<img
  className="cb-asset"
  src="/comic-book/character-agent.png"
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

### Page transition — Misregistration effect

When React Router changes the active route:

1. **Phase 1 — Separation (300 ms):** Four full-viewport canvas layers (CMYK: cyan overlay, magenta overlay, yellow overlay, black/key panel lines) begin drifting in four different directions (e.g. `translate(-8px,-4px)`, `translate(6px,-6px)`, `translate(4px,8px)`, `translate(0,0)`). The outgoing page content `opacity` fades from 1 → 0 over 300 ms.
2. **Phase 2 — Hold (50 ms):** All layers maximally offset. Canvas renders only the drifted layers.
3. **Phase 3 — Collapse + reveal (300 ms):** Layers animate back to `translate(0,0)`. The incoming page content `opacity` fades from 0 → 1.

Implementation: a `<MisregistrationOverlay>` canvas component with an `isTransitioning` prop lives in `Layout.tsx`. Listen for `location` changes from React Router and trigger the animation via `useEffect`.

Layer drift directions at 50% (0% and 100% are `translate(0,0)`):

| Layer | Peak translation |
| --- | --- |
| Cyan | `(-8px, -4px)` |
| Magenta | `(6px, -6px)` |
| Yellow | `(4px, 8px)` |
| Black (key) | `(0, 0)` — static |

### Panel separator lines

Drawn on a static `<canvas>` that sits behind content panels. Lines are redrawn on `resize`. Use canvas `lineCap: 'square'`, `lineWidth: 5`, `strokeStyle: '#111111'`.

## Hard Rules Summary

1. **Never use border-radius** on panels, buttons, or cards — flat ink-cut corners only
2. **Never use CSS transitions for page navigation** — only the misregistration canvas effect
3. **Never import Three.js, R3F, or any WebGL library** — this skin is canvas 2D + DOM only
4. **Never use CSS gradients as backgrounds** — Ben-Day dots only; solid fills for panels
5. **Never color assets with CSS color property** — always via `filter: sepia/saturate/hue-rotate`
6. **Never render panel separator lines with CSS `border`** — always drawn on canvas
7. **Never use cold/neutral fonts** — only Bangers (display) and Comic Neue (body)
8. **All text in nav/headings must be UPPERCASE** — enforce at CSS level with `text-transform: uppercase`
9. **Ben-Day dot canvas must always be running** (never frozen on a static frame) even when no interaction is happening
10. **Gemini assets live exclusively in `public/comic-book/`** — no inline base64, no external URLs
11. Files over 250 lines (TS/TSX/CSS) must be split before commit.
