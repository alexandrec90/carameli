---
description: Comic Book skin motion reference — per-panel Ben-Day dot animation, hover colorization, the Ben-Day page-transition wash, and panel separator ink
paths:
  - frontend/src/skins/comic-book/**/*.ts
  - frontend/src/skins/comic-book/**/*.tsx
  - frontend/src/skins/comic-book/**/*.css
---

# Rule: Comic Book Skin — Motion & Animation

> **Scope:** the motion half of `.claude/rules/skin-comic-book.md`, split out of it so
> neither file grows past the instruction-size limit. The palette, layout, component and
> typography doctrine stays there; what moves, and at what rate, is here.

## Ben-Day dot motion — only on the active panel

One `requestAnimationFrame` loop drives every panel's dot canvas (`usePanelDots.ts`),
but a panel is repainted only while it is **active** — hovered, which is also when its
picture colorizes. A resting panel keeps the frame it stopped on.

**Each panel owns its clock, and the clock is what stops** (`panelDotAnim.ts`). Drawing
from a shared wall clock is the version to avoid: the pattern would jump forward by
however long the pointer had been away the moment it returned, so every departure and
return would land as a cut instead of a pause and a resume. Panels are seeded from
their shipped `phase`, so a page at rest is not eight copies of one frame. An inactive
panel is repainted for exactly one reason — its canvas went blank (resize, remount, or
a pattern switch in the editor) — and then at the clock it froze on, not a fresh one.

This is why eight simultaneous patterns cost one panel's worth of drawing, and why the
eye is not pulled off the panel the pointer is on.

Every style in `PATTERN_STYLES` moves, and every one is tuned far slower than the
3-second breathe cycle — the drift should be noticed after watching, never read as a
moving image. The renderers are split by *what* moves: `patternDrawFields.ts` drifts
the field the dots are sized from, `patternDrawRadial.ts` turns a focal pattern.

**`concentric-rings` is the reference motion, and `patternWave.ts` is where it lives.**
A wave travels through the dot field; dots swell and ink up as its crest arrives, then
shrink and fade as it leaves. Every style is built from that same `travellingWave`
term rather than its own drift — which is what keeps eight patterns reading as one
page. Two rates and a spin are the whole vocabulary: `WAVE_RATE` for a wave expanding
from a point, `SWEEP_RATE` (half of it) for one crossing the panel in a straight line,
`SPIN_RATE` for a ray fan.

A slow drift of a whole field is the shape to avoid, and three styles shipped it
before 2026-08-25: slow enough to read as calm is slow enough to look static, and fast
enough to see is the entire picture sliding. A wave through a still field is legible
at a slow pace because the eye tracks its crest instead of the field.

| Style | What moves |
| --- | --- |
| `halftone-gradient` | a wave sweeps down the gradient axis; the dense end also drifts along it |
| `sunburst` | the ray fan turns, one revolution in ~6 minutes |
| `color-block` | a swell travels along the zone boundary, on a slower tide |
| `vignette` | rings run out through the dark edge; the clear middle opens and closes like an aperture |
| `radial-dots` | rings run out from a focal point that wanders an open loop (two rates, so it never quite retraces) |
| `diagonal-stripes` | a wave sweeps across the panel at the band angle, one band per ~14 s |
| `concentric-rings` | ring waves travel outward from the focal point |
| `corner-burst` | the same wheel of rays as `sunburst`, turning at the same rate, seen from a corner |

`corner-burst`'s fan covers the **whole circle** even though a corner shows a quarter
of it. A fan spanning only the visible quarter cannot turn — rotate it and it swings
off the panel — so it rocked about a fixed axis instead, which reads as a twitch. Its
`rayCount` keeps sunburst's meaning of wedges *across the panel*, and the wheel is
built with four times that many.

Dot radius also breathes ± 0.35 px on a 3-second sine, shared by every style —
which is why `panelPatternMotion.test.ts` leaves radius out of the frame signature it
compares. A style that only breathed would otherwise pass a test for animating.

## Hover colorization

Asset images transition from grayscale to colorized via CSS `transition: filter 200ms ease-out`. No JS required.

## Page transition — Ben-Day wash

All math and drawing live in `benDayWash.ts`; `Layout.tsx` listens for React Router
`location` changes and drives a `requestAnimationFrame` loop on a single full-viewport
canvas (`.cb-wash-canvas`, blank when idle). A halftone wave travels along the `x + y`
diagonal from the top-left corner:

1. **Phase 1 — Cover (420 ms):** paper-colored (`--cb-white`) dots grow inside a 220 px wave-front band until they merge into an opaque sheet (merge radius `spacing × 0.75` ≥ the `S·√2/2` tiling bound). The old page is washed away under the sheet.
2. **Phase 2 — Hold (120 ms):** full coverage. The sheet carries the loading screen's diagonal Ben-Day ripple, tinted with the incoming page's accent color — visually identical to the loading overlay.
3. **Phase 3 — Reveal (420 ms):** the same wave passes on; dots shrink behind the reveal front, uncovering the new page.

| Property | Value | Notes |
| --- | --- | --- |
| Grid spacing | `20 px` | shared with the loading ripple so the surfaces align |
| Wave band depth | `220 px` | growing/shrinking dot edge |
| Ripple wavelength / speed | `260 px` / `0.55 cycles·s⁻¹` | identical constants for wash and loading screen |
| Easing | ease-in-out cubic per phase | `washPhaseAt(elapsedMs)` |

The loading overlay uses the same module: its background is `drawLoadingRipple` (paper +
full ripple on the same grid), and when assets finish loading it exits via the wash's
reveal phase (`drawWash` with cover pinned at 1) instead of snapping away — the loading
screen and page transitions are one continuous visual system.

## Panel separator lines

Each panel is stroked as one closed `<polygon>` on a viewport-level SVG above the
pictures (`stroke="#111111"`, `strokeWidth="5"`, `strokeLinejoin="miter"`), so a panel's
ink follows its shape however the grid is dragged. There is no separate line layer:
what reads as a separator is the two panels' own borders either side of the gutter.
The Ben-Day dots are still per-panel canvases, clipped to the same polygon.
