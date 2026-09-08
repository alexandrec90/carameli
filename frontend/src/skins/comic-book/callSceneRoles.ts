import type { SceneHalf, SceneHalves } from './callSceneGeometry'
import type { CallRole, CallSceneLayout } from './editor/types'
import type { CallScenePhase } from './phoneActions'
import type { CallSpeaker } from '../../lib/callTranscript'

// What a `call` role *means* — which half of the split it is framed against, and when it
// is on screen. Kept apart from callSceneGeometry.ts (which knows only about polygons) and
// from the editor's ops (which know only about configs), because both of those need these
// answers and neither should own them.

/** Every role, in the order the inspector offers them. */
export const CALL_ROLES: CallRole[] = ['ringing', 'remote', 'local', 'scene']

/** How each role reads in the editor's role picker. */
export const CALL_ROLE_LABELS: Record<CallRole, string> = {
  ringing: 'Far end, ringing',
  remote: 'Far end, answered',
  local: 'The caller',
  scene: 'Across the whole panel',
}

/** Which of the two halves a role is framed against, or the panel itself. */
export type CallSide = 'a' | 'b' | 'panel'

export function isCallRole(value: unknown): value is CallRole {
  return typeof value === 'string' && (CALL_ROLES as string[]).includes(value)
}

/**
 * The half a role is placed in. `ringing` and `remote` share one: they are the same
 * person at the same end of the line, before and after they pick up, so an author who
 * frames one has framed the other's box too.
 */
export function callSide(role: CallRole): CallSide {
  if (role === 'ringing' || role === 'remote') return 'a'
  if (role === 'local') return 'b'
  return 'panel'
}

/**
 * The roles drawn on one side at a given phase — the whole of "which layer of the call is
 * on screen". Two roles never share a side at the same moment, which is what lets the far
 * end swap from a ringing telephone to the person who answered it without either being
 * repositioned.
 */
export function rolesOnSide(side: CallSide, phase: CallScenePhase): CallRole[] {
  if (side === 'a') return [phase === 'ringing' ? 'ringing' : 'remote']
  if (side === 'b') return ['local']
  return ['scene']
}

/**
 * Every role on screen at a phase — the whole call layout, both halves and the panel.
 *
 * Stated once because two components have to agree on it exactly: the panel draws what
 * this returns, and the editor's overlay hit-tests it. A layout where the click targets
 * and the drawing disagree is one where a handle drags something invisible.
 */
export function rolesAtPhase(phase: CallScenePhase): CallRole[] {
  return [...rolesOnSide('a', phase), ...rolesOnSide('b', phase), ...rolesOnSide('panel', phase)]
}

/** Whether an entry with this `call` field is drawn, given the side's visible roles. */
export function inRoles(call: CallRole | undefined, roles: CallRole[] | null): boolean {
  // `null` is the panel's ordinary layout: everything that is not part of a call.
  if (roles === null) return call === undefined
  return call !== undefined && roles.includes(call)
}

/**
 * Whether a balloon is drawn at this moment of the call.
 *
 * Its role has to be on screen, exactly as a picture's does — and a `transcript` waits for
 * the pickup besides. There are no words before it, and a balloon standing empty over a
 * ringing telephone reads as the call having nothing to say rather than as nobody having
 * answered yet. "Answered" is read off the roles themselves: the far end's answered face
 * is on screen exactly when the call is connected, so the question can be asked wherever
 * the roles already are without a second fact carried beside them.
 *
 * Asked by the drawing (`PanelBubbles`), the click targets (`OverlayTargets`) and the
 * selection outline (`overlaySelection`) alike, so a transcript the page is not drawing is
 * also one the editor offers no handle for.
 */
export function bubbleDrawn(
  bubble: { call?: CallRole; content: string },
  roles: CallRole[] | null,
): boolean {
  if (!inRoles(bubble.call, roles)) return false
  if (bubble.content !== 'transcript' || roles === null) return true
  return roles.includes('remote')
}

/**
 * The role a new entry takes when it is added while `phase` is the layout on screen: the
 * far end's role for that phase, the one role drawn at that moment and not at the other.
 *
 * The narrowest answer on purpose. An author standing in Ringing who adds a balloon
 * expects it in Ringing; a role drawn in both phases would have it turn up in Connected
 * too, and `scene` would besides measure it against the whole panel while everything
 * beside it is measured against a half. Widening it is one change in the role select.
 */
export function roleForPhase(phase: CallScenePhase): CallRole {
  return rolesOnSide('a', phase)[0]
}

/**
 * The role an entry added to `panel` should carry while `phase` is up, or none.
 *
 * None unless the panel is already a call: a role on a panel that has no scene would
 * *make* it one, cutting the panel in two under an author who only asked for a balloon.
 * And none on the default layout, where a role would put the new entry off screen — the
 * add would then appear to have done nothing, which is the failure this exists to stop
 * in the other direction.
 */
export function newEntryRole(
  scenes: readonly CallSceneLayout[],
  panel: number,
  phase: CallScenePhase | null,
): CallRole | undefined {
  return phase !== null && callSceneOn(scenes, panel) ? roleForPhase(phase) : undefined
}

/**
 * The roles `panel` is drawing at this moment, or null for its ordinary layout — a panel
 * is a call only if its author gave it a scene *and* a call is up.
 *
 * Stated here, beside {@link inRoles}, because every caller needs the pair and a caller
 * that spells the pairing itself is a second rule free to drift from the drawing. One did:
 * the loading overlay counted the pictures on the page without asking this, so it waited
 * on call-role pictures that mount only during a call and never revealed the home page.
 */
export function panelRoles(
  scenes: readonly CallSceneLayout[],
  panel: number,
  call: { phase: CallScenePhase } | null | undefined,
): CallRole[] | null {
  return call && callSceneOn(scenes, panel) ? rolesAtPhase(call.phase) : null
}

/**
 * The half an entry with this `call` field is framed against, or null for the panel's own
 * box — which is what a `scene` role, and anything with no role at all, is measured in.
 *
 * Null rather than a whole-panel {@link SceneHalf} on purpose: "no half" is the case every
 * picture and balloon on every other panel is already in, so the renderers keep one code
 * path for it instead of gaining a slot element that spans the panel exactly.
 */
export function halfFor(
  call: CallRole | undefined,
  halves: SceneHalves | null,
): SceneHalf | null {
  if (call === undefined || halves === null) return null
  const side = callSide(call)
  return side === 'panel' ? null : halves[side]
}

/**
 * The roles lit — colorized, and their balloons inked heavy — at this moment of the call.
 *
 * Exactly one thing lights a figure in a call scene: they are the one making a sound. Before
 * the pickup that is the ringing telephone, unconditionally, since a ring is the only sound
 * there is; after it, whichever seat is talking, and neither during a silence.
 */
export function litRoles(phase: CallScenePhase, speaking: CallSpeaker | null): CallRole[] {
  if (phase === 'ringing') return ['ringing']
  if (speaking === 'remote') return ['remote']
  if (speaking === 'local') return ['local']
  return []
}

/**
 * The seat a role's words come from, or null for one that is not a seat.
 *
 * 'ringing' answers 'remote' rather than null: it is the far end before they speak, so a
 * transcript balloon framed for the ringing telephone is the same balloon that fills with
 * their words the moment they do — which is what lets the two share a half.
 */
export function callSpeaker(role: CallRole): CallSpeaker | null {
  if (role === 'local') return 'local'
  if (role === 'remote' || role === 'ringing') return 'remote'
  return null
}

/**
 * Accessible name for a transcript balloon's log, by the role it carries. A balloon with
 * no role — an author's transcript outside any call layout — takes the last of these: it
 * is still a window on a conversation, just not on one seat of it.
 */
export const CALL_TRANSCRIPT_LABELS: Record<CallRole | 'none', string> = {
  ringing: 'What they said',
  remote: 'What they said',
  local: 'What you said',
  scene: 'What was said',
  none: 'What was said',
}

/** The scene on `panel`, or undefined when that panel has no call layout. */
export function callSceneOn(
  scenes: readonly CallSceneLayout[],
  panel: number,
): CallSceneLayout | undefined {
  return scenes.find(s => s.panel === panel)
}
