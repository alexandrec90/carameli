import type { UseSoftphoneResult } from '../../hooks/useSoftphone'
import type { CallTranscript } from '../../lib/callTranscript'
import { canHangup } from '../../lib/softphone'

/**
 * The two keys an `actions` balloon can draw: the green one and the red one, the only
 * controls a drawn telephone has ever had.
 */
export type PhoneActionId = 'call' | 'hangup'

export interface PhoneAction {
  id: PhoneActionId
  /** The drawn key, served from `public/comic-book/`. */
  src: string
  /**
   * The button's accessible name. The artwork is the button's only other content, so
   * without this the control is a nameless one to a screen reader.
   */
  label: string
}

/**
 * Authored label → the key it names.
 *
 * Keyed on letters alone, so `End call`, `end-call` and `END CALL` are one entry rather
 * than three near-copies an author has to spell exactly. A label that matches nothing
 * here is not an error: `BubbleActions` letters it, which is what a balloon with no
 * telephone behind it looks like in the editor.
 */
/**
 * The green key on its own, because a `dial-call` balloon draws it beside its field
 * rather than from a label an author typed (BubbleCallKey). Exported so the artwork and
 * the accessible name are stated once: a second copy of the path is a key that stops
 * being the same key the moment either is renamed.
 */
export const CALL_KEY: PhoneAction = {
  id: 'call',
  src: '/comic-book/call-button.webp',
  label: 'Call',
}

/** The red key, for the same reason: a call layout letters one beside the caller's words. */
export const HANGUP_KEY: PhoneAction = {
  id: 'hangup',
  src: '/comic-book/end-call-button.webp',
  label: 'End call',
}

const KEYS: Readonly<Record<string, PhoneAction>> = {
  call: CALL_KEY,
  endcall: HANGUP_KEY,
}

/** Fold an authored label onto its key, or null when it names none. */
export function phoneAction(label: string): PhoneAction | null {
  return KEYS[label.toLowerCase().replace(/[^a-z]+/g, '')] ?? null
}

/** What a key does right now, and whether the telephone has anything for it to do. */
export interface PhoneActionHandler {
  run(): void
  disabled: boolean
}

export type PhoneActionHandlers = Readonly<Partial<Record<PhoneActionId, PhoneActionHandler>>>

/**
 * Wire the two keys to the page's softphone.
 *
 * A handset has one green key and one red one whatever the call is doing, so the meaning
 * of each moves with the state rather than a third and fourth key appearing on the
 * drawing: green answers a ringing call and otherwise dials, red declines one and
 * otherwise hangs up. Neither is ever hidden — a key that vanishes off a photographed
 * telephone reads as a fault in the picture — so a key with nothing to do is disabled
 * instead, and `bubbleInputs.css` greys it only outside the editor.
 *
 * The number dialled is `dialTarget`, which is what the projected number pad types into;
 * a `phone` balloon holds its number in a field of its own and places its call on Enter.
 */
export function softphoneActions(phone: UseSoftphoneResult): PhoneActionHandlers {
  const ringing = phone.callStatus === 'ringing'
  const onCall = canHangup(phone.callStatus)
  return {
    call: ringing
      ? { run: () => { void phone.answer() }, disabled: phone.busy }
      : {
          run: () => { void phone.autoDial() },
          disabled: phone.busy || onCall || phone.dialTarget === '',
        },
    hangup: ringing
      ? { run: () => { void phone.decline() }, disabled: false }
      : { run: () => { void phone.hangup() }, disabled: !onCall },
  }
}

/** What the scene shows: the far end ringing, or the two parties talking. */
export type CallScenePhase = 'ringing' | 'connected'

/**
 * The call, as a panel with a call layout draws it: which phase it is in, and the words.
 *
 * No handler for the red key: ending a call is what an `actions` balloon lettered
 * `End call` does, on this panel like on any other, through `softphoneActions`. The scene
 * used to carry one because it drew that key itself, and a second way to hang up was a
 * second thing to keep in step with the phone's state.
 */
export interface CallScene {
  phase: CallScenePhase
  transcript: CallTranscript
}

/**
 * The scene for the phone's current call, or null when there is none to draw. An
 * outbound call is a scene from the moment it is dialled; an inbound one only once it is
 * answered, since until then the drawn telephone's keys are the whole story.
 */
export function callSceneOf(phone: UseSoftphoneResult): CallScene | null {
  const phase: CallScenePhase | null =
    phone.callStatus === 'dialing' ? 'ringing' : phone.callStatus === 'active' ? 'connected' : null
  if (phase === null) return null
  return { phase, transcript: phone.transcript }
}
