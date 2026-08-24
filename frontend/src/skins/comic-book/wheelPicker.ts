// The pure half of the in-bubble wheel picker: how a bubble's `text` becomes the
// option list, and how raw wheel deltas become selection steps. BubbleWheel.tsx is
// the thin DOM shell over these; keeping the math here keeps it unit-testable the
// way the rest of the skin's geometry is (see bubbleShape.ts, transforms.ts).

/**
 * One wheel row's height in em of the picker's own font size. The track offset is
 * computed from this in JS; `.cb-wheel-option` in bubbles.css states the same height
 * in CSS. Keep the two in step or the highlighted row drifts off the bubble's centre
 * one row-fraction per step.
 */
export const WHEEL_ROW_EM = 1.25

/**
 * Wheel travel (px of `deltaY`) per selection step. One notch of a stepped mouse
 * wheel is ~100px in Chromium, so a notch is one step; a trackpad drips deltas of
 * 1-10px and accumulates across events instead of spinning a step per twitch.
 */
export const WHEEL_STEP_DELTA = 60

/**
 * The comma-delimited option list an author typed into the bubble's text field.
 * Whitespace around a comma is the author laying the line out, not part of an
 * option, and an empty entry (a trailing comma) is nothing to pick.
 */
export function splitOptions(text: string): string[] {
  return text
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/** Pull an index back into `[0, count)`; -1 for an empty list (nothing to select). */
export function clampIndex(index: number, count: number): number {
  if (count <= 0) return -1
  return Math.min(Math.max(index, 0), count - 1)
}

/**
 * Fold one wheel event into the running accumulator and say how many whole steps
 * fell out of it. The remainder stays in `acc`, which is what makes a slow trackpad
 * drag land exactly one step per WHEEL_STEP_DELTA of travel instead of rounding to
 * zero on every event. The wheel stops at the ends rather than wrapping -- clampIndex
 * is applied by the caller -- matching what a physical drum does.
 */
export function wheelSteps(acc: number, deltaY: number): { acc: number; steps: number } {
  const total = acc + deltaY
  // `|| 0` folds Math.trunc's -0 (any small negative total) back to plain 0.
  const steps = Math.trunc(total / WHEEL_STEP_DELTA) || 0
  return { acc: total - steps * WHEEL_STEP_DELTA, steps }
}

/**
 * Vertical offset of the option track, in em, that puts row `index`'s centre on the
 * container's centre line (the track is anchored at `top: 50%`).
 */
export function wheelOffsetEm(index: number): number {
  return -(index + 0.5) * WHEEL_ROW_EM
}
