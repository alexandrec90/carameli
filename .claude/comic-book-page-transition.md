# Comic Book skin — the page transition and its lit grid

Support file for [`.claude/rules/skin-comic-book.md`](rules/skin-comic-book.md), which
holds the skin's rules; this is the detail behind one of them. The three surfaces here —
the wash, the loading sheet and the letterbox — are one picture drawn by three files, so
retuning any of them means reading all three.

## The page transition — the Ben-Day wash

Geometry and drawing live in `benDayWash.ts`; `usePageWash.ts` watches React Router's
`location` and drives a rAF loop on one full-viewport canvas (`.cb-wash-canvas`, blank when
idle). A halftone wave travels the `x + y` diagonal from the top-left: **cover** (paper dots grow
inside the band until they merge opaque) → **hold** (the sheet carrying the loading screen's dot
grid) → **reveal** (the wave passes on and dots shrink behind it), eased ease-in-out cubic per
phase (`washPhaseAt`). When retuning, keep the merge radius at or above the `S·√2/2` tiling bound
(below it the dots never close), and the grid spacing **shared with the loading sheet** so the
two surfaces align. The loading overlay reuses it — `drawLoadingGrid` behind it, exiting through
the reveal at cover 1.

**The grid is still and the pointer is its light** (`spotlight.ts`). The dots sit on one viewport
grid in the route accent, small and faint at rest; a pool of light `SPOT_REACH` wide follows the
cursor, and each dot swells to `GRID_SPOT_R` and darkens by how far inside it it sits (`gridDot`,
raised-cosine `spotlightFalloff`). The light chases the pointer on `SPOT_FOLLOW_MS`, comes up and
goes out on `SPOT_FADE_MS` (out when the pointer leaves the window, at rest in the viewport centre
until it has first moved), and `pageSpotlight()` is the **one** tracker every surface samples, so the
loading sheet, the wash and the letterbox light the same dot the same way at the same instant. A
loop samples it with the rAF stamp and repaints only when the sample changed (`stepSpotlight`
returns the previous state by identity when nothing moved). Keep `GRID_SPOT_R` under half the
pitch: a lit dot that touched its neighbours would read as a blot, not as halftone swelling.

**The letterbox carries the loading grid on** (`MarginGrid.tsx`, the bottom layer of `.cb-root`):
the fixed aspect leaves most windows a band beside or above the page sheet, and `drawMarginGrid`
paints the grid there on the same cells under the same light, so the sheet the loading screen
washes away reveals what it was already showing, lit where it was lit. It stays outside the sheet —
`pageSheet` is the frame *as drawn* plus `OUTER_M`, so a held shape gets its bands — and runs only
while a band exists, once the page is up. It does **not** consult `prefers-reduced-motion`: the
grid moves only as the pointer does, and a light that stopped following the hand would read as
the page having hung (`MarginGrid.test.tsx`).
