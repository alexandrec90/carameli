// ─── Shared motion terms ─────────────────────────────────────────────────────
// The pace and the shape of every pattern's movement, in one place.
//
// `concentric-rings` is the reference. Its motion is a wave that travels outward
// from a focal point, and dots that fade, shrink and swell again as it passes —
// the one that reads as slow while still being visible at all. Every other style's
// motion is built from the same term rather than inventing its own drift, which is
// how eight patterns end up looking like one page instead of eight screensavers.
//
// The renderers live in patternDrawFields.ts and patternDrawRadial.ts.

/**
 * A wave passing `pos` (in px): 0 in its trough, 1 at its crest, one full pass
 * every `period` px, moving at `rate` radians per second.
 *
 * Scale a dot's radius *and* its alpha by the result and the wave reads as dots
 * swelling and inking up as it arrives, then shrinking and fading as it leaves.
 * Scaling only one of the two gives either a size flicker or a flat pulse.
 */
export function travellingWave(
    pos: number, period: number, t: number, rate: number,
): number {
    return (Math.sin((pos / period) * Math.PI * 2 - t * rate) + 1) / 2
}

/**
 * Radians per second for a wave travelling *outward from a focal point* — rings,
 * vignettes, radial fields. This is concentric-rings' own rate, kept unchanged
 * because that pattern is the one the pace was signed off on.
 */
export const WAVE_RATE = 0.9

/**
 * Radians per second for a wave sweeping *across* a panel in a straight line.
 *
 * Half the ring rate, deliberately: an expanding ring spends its motion spreading
 * out in every direction at once, while a straight sweep spends all of it going
 * one way, so the same number reads much faster. Diagonal stripes previously slid
 * a hard-edged band at a comparable pace and were called out as too fast — a soft
 * wave at half the ring rate is what replaced it.
 */
export const SWEEP_RATE = 0.45

/** Radians per second a ray fan turns at — one revolution in about six minutes. */
export const SPIN_RATE = 0.018
