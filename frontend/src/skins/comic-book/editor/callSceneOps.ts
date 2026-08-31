import { isCallRole } from '../callSceneRoles'
import type { CallRole, CallSceneLayout } from './types'

// The call-scene list's lifecycle, and the `call` fields the list is derived *through*.
// It sits apart from configOps.ts for the reason chainOps.ts does: a scene is not edited
// the way a picture or a bubble is. There is no "add a scene" and no "delete a scene" —
// a panel is a phone call for exactly as long as something on it carries a role, so
// `syncCallScenes` recomputes the list from the entries and the only direct edit is
// patching a scene that already exists.
//
// A scene with no members would draw two empty halves over the panel's real contents and
// still offer a seam in the inspector; an entry carrying a role on a panel with no scene
// would be invisible with nothing to say so. Both are unreachable if the list is a
// function of the entries.

/** Where a fresh scene's seam falls: the middle, which is what "split in two" reads as. */
export const DEFAULT_CALL_CUT = 50

/** Which way a fresh scene is cut. Side by side — two people facing each other. */
export const DEFAULT_CALL_AXIS: CallSceneLayout['axis'] = 'x'

/**
 * How far the seam may travel. Held rather than trusted for the same reason a chain's row
 * count is: a cut at 0 leaves a half with no area, which is not a layout the author can
 * see well enough to drag back.
 */
export const CALL_CUT = { min: 10, max: 90, step: 1 }

/** Pull a seam position into the range the inspector offers. */
export function clampCut(cut: number): number {
  if (!Number.isFinite(cut)) return DEFAULT_CALL_CUT
  return Math.min(Math.max(Math.round(cut), CALL_CUT.min), CALL_CUT.max)
}

/** Shallow clone — a scene is three scalars, so this is the whole of it. */
export function cloneCallScene(s: CallSceneLayout): CallSceneLayout {
  return { panel: s.panel, cut: clampCut(s.cut), axis: s.axis === 'y' ? 'y' : 'x' }
}

/** Runtime guard for a persisted entry, mirroring `isBubbleChain`. */
export function isCallSceneLayout(value: unknown): value is CallSceneLayout {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<CallSceneLayout>
  return (
    typeof v.panel === 'number' &&
    Number.isInteger(v.panel) &&
    v.panel >= 0 &&
    typeof v.cut === 'number' &&
    Number.isFinite(v.cut) &&
    (v.axis === 'x' || v.axis === 'y')
  )
}

/** An entry's role when it has a valid one, else undefined — what "in the call" means. */
export function roleOf(entry: { call?: CallRole }): CallRole | undefined {
  return isCallRole(entry.call) ? entry.call : undefined
}

/**
 * The panels a call is drawn on: those holding at least one picture or balloon with a
 * role. Ascending, so the list's order is a property of the page rather than of which
 * array the author happened to mark something in first.
 */
export function callPanels(
  images: readonly { panel: number; call?: CallRole }[],
  bubbles: readonly { panel: number; call?: CallRole }[],
): number[] {
  const panels = new Set<number>()
  for (const e of images) if (roleOf(e) !== undefined) panels.add(e.panel)
  for (const e of bubbles) if (roleOf(e) !== undefined) panels.add(e.panel)
  return [...panels].sort((a, b) => a - b)
}

/**
 * Reconcile the scene list against the entries: one entry per panel that has a call on
 * it, keeping the seam an existing scene already carried and creating a centred one for
 * a panel that has just become a call. Panels nothing marks any more are dropped.
 *
 * Run after every edit that can touch an entry's `call` or its `panel`, or its existence
 * — which is why {@link reconcile} now runs on picture ops too, and not only on the
 * bubble ops it was written for.
 */
export function syncCallScenes(
  images: readonly { panel: number; call?: CallRole }[],
  bubbles: readonly { panel: number; call?: CallRole }[],
  scenes: readonly CallSceneLayout[],
): CallSceneLayout[] {
  const existing = new Map(scenes.map(s => [s.panel, s]))
  return callPanels(images, bubbles).map(panel => {
    const found = existing.get(panel)
    return found
      ? cloneCallScene(found)
      : { panel, cut: DEFAULT_CALL_CUT, axis: DEFAULT_CALL_AXIS }
  })
}

/**
 * Patch-merge one scene by panel, returning a new list. A patch for a panel with no scene
 * is a no-op rather than an insert, for the same reason `patchChainIn`'s is: the list is
 * the entries' to grow, and a seam on a panel drawing no call has nothing to move.
 */
export function patchCallSceneIn(
  scenes: readonly CallSceneLayout[],
  panel: number,
  patch: Partial<CallSceneLayout>,
): CallSceneLayout[] {
  return scenes.map(s => {
    if (s.panel !== panel) return cloneCallScene(s)
    // `panel` is the join key, not a setting — moving a scene to another panel here would
    // strand every entry pointing at this one, and the move that *does* work is on the
    // entry's own panel field.
    return cloneCallScene({ ...s, ...patch, panel: s.panel })
  })
}

/**
 * Read a persisted scene list back, dropping entries that are not scenes and clamping the
 * ones that are. Returns [] for anything that is not an array — the same answer as a
 * payload written before call scenes existed, which {@link syncCallScenes} then rebuilds
 * from the entries, so an old payload loses only seams it never had.
 */
export function hydrateCallScenes(raw: unknown): CallSceneLayout[] {
  if (!Array.isArray(raw)) return []
  const out: CallSceneLayout[] = []
  const seen = new Set<number>()
  for (const stored of raw) {
    if (!isCallSceneLayout(stored) || seen.has(stored.panel)) continue
    seen.add(stored.panel)
    out.push(cloneCallScene(stored))
  }
  return out
}
