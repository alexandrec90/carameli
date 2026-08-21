// The comic grid's geometry: where each panel rectangle lands for a given viewport.
//
// Every panel is sized from its artwork. PANEL_ART_SIZES holds each picture's natural
// pixel size, and computeLayout hands the panel exactly that aspect ratio — so the
// black frame drawn around a panel IS the original image's rectangle, scaled. The
// contain-fit picture then fills its frame edge to edge instead of floating inside a
// box whose shape was chosen by hand percentages (the old layout gave the landscape
// mail-carrier art a portrait-ish panel at most window sizes).
//
// Rows share one picture-width `t`: each row's height is t / (sum of its aspects), so
// all rows come out equally wide and the block centres in the viewport. `t` is the
// largest value that fits both axes; whatever the viewport's shape, panels keep their
// art's proportions and the leftover space becomes page margin, never distortion.

// ─── Layout constants ─────────────────────────────────────────────────────────

const OUTER_M = 8  // minimum margin from viewport edge to outermost panel outline
const GUTTER = 14  // px between adjacent panel outlines
const SPILL = 15   // px that images may bleed beyond the panel outline on spill edges

// ─── Panel polygon types ──────────────────────────────────────────────────────

/** A single panel described by its tight polygon and image-spill geometry. */
export interface PanelPoly {
  /** Tight polygon in absolute viewport coords [TL, TR, BR, BL] */
  vp: [number, number][]
  /** Bounding rect of the tight polygon */
  bounds: { x: number; y: number; w: number; h: number }
  /** Spill polygon in absolute viewport coords (expanded on outer edges) */
  spillVP: [number, number][]
  spillTop: boolean
  spillRight: boolean
  spillBottom: boolean
  spillLeft: boolean
}

// ─── Panel art sizes ──────────────────────────────────────────────────────────

/**
 * Natural pixel size of each panel's artwork, index-parallel to PANELS.
 * comicBookPanelLayout.test.ts asserts these against the real files in
 * public/comic-book/, so a swapped or re-exported asset fails the suite instead of
 * quietly skewing every frame.
 */
export const PANEL_ART_SIZES: { w: number; h: number }[] = [
  { w: 796, h: 615 }, // logo
  { w: 2816, h: 1536 }, // switchboard
  { w: 2816, h: 1536 }, // mailman1
  { w: 1914, h: 1492 }, // mechanic
  { w: 1671, h: 1487 }, // receptionist
  { w: 1455, h: 1536 }, // rolodex
  { w: 2816, h: 1536 }, // rotary phone
  { w: 2816, h: 1536 }, // mailman2
]

const ASPECTS = PANEL_ART_SIZES.map(s => s.w / s.h)

// Which panels share a row, per viewport regime. Indices into PANELS.
const LANDSCAPE_ROWS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7],
]
const SQUARE_ROWS = [
  [0, 1, 2],
  [3, 4],
  [5, 6, 7],
]
const PORTRAIT_ROWS = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
]

// ─── Layout helpers ───────────────────────────────────────────────────────────

function polyBounds(pts: [number, number][]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map(p => p[0])
  const ys = pts.map(p => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Expand a [TL, TR, BR, BL] polygon outward on each side. */
function expandPoly(
  pts: [number, number][],
  top: number,
  right: number,
  bottom: number,
  left: number,
): [number, number][] {
  const [TL, TR, BR, BL] = pts
  return [
    [TL[0] - left, TL[1] - top],
    [TR[0] + right, TR[1] - top],
    [BR[0] + right, BR[1] + bottom],
    [BL[0] - left, BL[1] + bottom],
  ] as [number, number][]
}

function makePoly(
  tight: [number, number][],
  spillTop: boolean,
  spillRight: boolean,
  spillBottom: boolean,
  spillLeft: boolean,
): PanelPoly {
  const sp = SPILL
  const bounds = polyBounds(tight)
  const spillVP = expandPoly(
    tight,
    spillTop ? sp : 0,
    spillRight ? sp : 0,
    spillBottom ? sp : 0,
    spillLeft ? sp : 0,
  )
  return { vp: tight, bounds, spillVP, spillTop, spillRight, spillBottom, spillLeft }
}

// ─── Layout computation ───────────────────────────────────────────────────────

/**
 * Lay the rows out at their art's exact aspect ratios and centre the block.
 *
 * `t` is the picture-width every row shares (gutters excluded). A row's height is
 * t / (sum of aspects), so its panels at their own aspects sum to exactly `t` wide. The
 * largest `t` that fits the viewport's height is capped by the width the widest row
 * may take; the remaining space on either axis becomes symmetric page margin.
 */
function computeAspectLayout(w: number, h: number, rows: number[][]): PanelPoly[] {
  const availW = w - 2 * OUTER_M
  const availH = h - 2 * OUTER_M
  const rowAspects = rows.map(r => r.reduce((sum, p) => sum + ASPECTS[p], 0))
  const invSum = rowAspects.reduce((sum, a) => sum + 1 / a, 0)
  const heightLimited = (availH - (rows.length - 1) * GUTTER) / invSum
  const widthLimited = Math.min(...rows.map(r => availW - (r.length - 1) * GUTTER))
  const t = Math.max(0, Math.min(heightLimited, widthLimited))

  const rowHeights = rowAspects.map(a => t / a)
  const blockH = rowHeights.reduce((sum, rh) => sum + rh, 0) + (rows.length - 1) * GUTTER

  const polys: PanelPoly[] = []
  let y = OUTER_M + (availH - blockH) / 2
  rows.forEach((row, i) => {
    const rh = rowHeights[i]
    const rowW = t + (row.length - 1) * GUTTER
    let x = OUTER_M + (availW - rowW) / 2
    for (const p of row) {
      const pw = ASPECTS[p] * rh
      const tight: [number, number][] = [
        [x, y],
        [x + pw, y],
        [x + pw, y + rh],
        [x, y + rh],
      ]
      polys[p] = makePoly(tight, false, false, false, false)
      x += pw + GUTTER
    }
    y += rh + GUTTER
  })
  return polys
}

export function computeLayout(w: number, h: number): PanelPoly[] {
  const ar = w / h
  if (ar < 0.85) return computeAspectLayout(w, h, PORTRAIT_ROWS)
  if (ar > 1.25) return computeAspectLayout(w, h, LANDSCAPE_ROWS)
  return computeAspectLayout(w, h, SQUARE_ROWS)
}
