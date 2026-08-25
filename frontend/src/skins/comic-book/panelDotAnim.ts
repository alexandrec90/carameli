import { PANEL_BG_CONFIGS } from './panelPatterns'

// ─── Ben-Day dot animation state ─────────────────────────────────────────────
// A panel's background animates only while the panel is *active* — hovered, which
// is also when its picture colorizes. At rest it holds a still frame: eight panels
// drifting at once reads as wallpaper and pulls the eye away from the one the
// pointer is on, which is the panel meant to be alive.
//
// Each panel therefore keeps its **own** clock, advanced only on the frames it is
// active. Drawing from a shared wall clock instead is the version to avoid: the
// pattern would jump forward by however long the pointer had been away the moment
// it came back, so every departure and return would land as a cut. Freezing the
// clock makes leaving a panel a pause and coming back to it a resume.
//
// The renderers themselves are in patternDrawFields.ts / patternDrawRadial.ts, and
// usePanelDots.ts is the rAF driver that puts the two together.

/**
 * Longest frame step honoured, in seconds. A backgrounded tab delivers one huge
 * gap on its way back; without this the pattern would leap rather than resume.
 */
export const MAX_FRAME_DT = 0.1

/** Seconds between two rAF timestamps, clamped. The first frame of a loop is 0. */
export function frameDelta(prevMs: number | null, nowMs: number): number {
    if (prevMs === null) return 0
    return Math.min(MAX_FRAME_DT, Math.max(0, (nowMs - prevMs) / 1000))
}

/**
 * The still frame panel `i` rests on until it is first hovered. Panels are seeded
 * from their shipped `phase` so a page of resting panels is not eight copies of
 * one frame — the same offsets that keep their breathing out of lockstep.
 */
export function restClock(i: number): number {
    return PANEL_BG_CONFIGS[i]?.phase ?? 0
}

export interface DotStep {
    /** The panel's clock after this frame. */
    clock: number
    /** Whether the canvas has to be repainted this frame. */
    paint: boolean
}

/**
 * Advance one panel's clock for a frame and say whether it needs repainting.
 *
 * `dirty` is the only reason an inactive panel repaints — its canvas was resized,
 * remounted or given a new pattern, and so is showing something other than the
 * frame it froze on. Without it a resize would leave a resting panel blank, since
 * a canvas loses its bitmap when its backing size changes.
 */
export function stepPanelDots(
    clock: number, active: boolean, dt: number, dirty: boolean,
): DotStep {
    if (active) return { clock: clock + dt, paint: true }
    return { clock, paint: dirty }
}
