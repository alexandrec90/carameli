// Which balloon on a revealed panel is being typed into.
//
// A field in a comic panel has no click-to-focus ritual: the panel lighting up *is* the
// invitation, so whatever the reader types goes somewhere the moment the pointer arrives.
// That rule used to be spelled twice and only for two balloons — a `dial` focused itself
// while its panel was revealed, and an SMS composer took the keyboard off it — so an
// ordinary `input` balloon drawn anywhere else sat there ignoring the keyboard until it
// was clicked. It is one rule here instead, in terms of *claims*, so a new content kind
// joins it by naming a claim rather than by teaching another component about dials.
//
// Pure, and keyed by opaque strings, so the whole hierarchy is testable without a render.

import { isDialContent } from './bubbleContent'
import { isComposerContent } from './bubbleChain'

/** Claims nothing: lettering, the telephone's keys, a picture with a keypad on it. */
export const CLAIM_NONE = 0
/**
 * Claims the panel only while the pointer is on it. A wheel picker has no field to type
 * into, so it never wants the keyboard by default — but it does want the scroll, and a
 * composer that kept eating keystrokes while the reader turned the drum beside it would
 * be answering for a balloon nobody is looking at.
 */
export const CLAIM_POINTER = 1
/** An ordinary field: `input`, `phone`, and either dial. */
export const CLAIM_FIELD = 2
/**
 * A conversation's composer, which outranks a plain field on the same panel. The panel
 * reads as a phone: the thread is what the reader is talking into, and the number beside
 * it is chosen once. Hovering the number still takes the keyboard, which is the whole of
 * how you reach it.
 */
export const CLAIM_COMPOSER = 3

/** One balloon's claim on its panel's keyboard. */
export interface KeyboardClaim {
  /** Opaque and stable for as long as the balloon is drawn — see `bubbleKey`/`chainKey`. */
  key: string
  claim: number
}

/**
 * Makes the reporter one claimant states its pointer through, given that claimant's key.
 * The panel owns the answer, so it owns the factory; a balloon is handed the half of it
 * that is about itself. See PanelBubbles.tsx for why a departure is not a blind clear.
 */
export type HoverReporter = (key: string) => (hovered: boolean) => void

/** Key for the flat balloon at `index` into the page's bubble list. */
export function bubbleKey(index: number): string {
  return `bubble:${index}`
}

/** Key for a conversation, which claims through its composer rather than per row. */
export function chainKey(id: string): string {
  return `chain:${id}`
}

/** What a balloon of this content kind claims when it is not part of a conversation. */
export function bubbleClaim(content: string): number {
  if (content === 'wheel') return CLAIM_POINTER
  if (content === 'input' || content === 'phone' || isDialContent(content)) return CLAIM_FIELD
  return CLAIM_NONE
}

/**
 * What a conversation claims, given the content of its sender template — the only member
 * that can be a composer (see `isComposerContent`). A chain drawn as an animation has no
 * field in it and claims nothing, which also leaves its wheel reaching over its own
 * balloons rather than over the whole panel.
 */
export function chainClaim(senderContent: string): number {
  return isComposerContent(senderContent) ? CLAIM_COMPOSER : CLAIM_NONE
}

/**
 * The balloon that owns a revealed panel's keyboard, or null when nothing does.
 *
 * Two rules, in order:
 *
 * 1. **The pointer wins.** Whatever a claimant is ranked, hovering it hands it the
 *    keyboard — which is what makes a panel with several fields navigable at all.
 * 2. **Otherwise the panel's main field owns it.** The highest claim, and the first of
 *    them when several tie — so a panel that has any field at all always has a live one,
 *    and the reader can type the moment it lights.
 *
 * A tie used to own nothing, on the grounds that draw order is not a fact the reader can
 * see. But neither is it one they have to see: what they see is a panel whose fields all
 * sit there dead until the pointer finds one, which is the click-to-focus ritual back
 * again under another name. Ranking settles the case that matters — a conversation's
 * composer is the main field beside the number that addresses it (CLAIM_COMPOSER), and
 * hovering the number is how you reach it — and order settles the rest, cheaply and
 * predictably, rather than leaving the panel mute.
 */
export function keyboardOwner(
  claims: readonly KeyboardClaim[],
  hovered: string | null,
): string | null {
  // A pointer-only claim is not a default: the drum takes the keyboard by being hovered
  // and gives it straight back, so a panel holding nothing else keeps it unclaimed.
  let rank = CLAIM_POINTER
  let owner: string | null = null
  for (const { key, claim } of claims) {
    if (claim > CLAIM_NONE && key === hovered) return key
    // Strictly higher keeps the first of equal claims, in the panel's draw order.
    if (claim > rank) {
      rank = claim
      owner = key
    }
  }
  return owner
}
