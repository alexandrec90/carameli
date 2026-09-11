import type { BubbleContentKind } from '../bubbleContent'

// PURE: what the bubble inspector says about a balloon, keyed by what fills it.
//
// A table rather than a branch per kind in the markup — the inspector is already at the
// complexity the gate allows — and its own module rather than a block at the top of
// BubbleInspector.tsx, which the prose alone would push past the skin's 250-line rule.
//
// Every entry here used to be a `.cb-ed-hint` paragraph stacked under the text box. They
// are the field's `?` now (see ./Hint.tsx), so a balloon costs one badge whatever it is
// set to, instead of up to six lines of the toolbar.

const DIAL =
  'Comma-delimited, same as the wheel — but this is an autocomplete: the drum’s centre '
  + 'line is a real phone field, and typing into it (or punching a number pad projected '
  + 'onto a picture on this panel) narrows the rows behind it. The first option is what '
  + 'it starts on; Enter dials, and adds the number to the list.'

const FIELD =
  'This becomes an editable field outside edit mode. Phone input formats while typing '
  + 'from the browser locale; a leading + always uses that country code.'

/**
 * The `?` beside a balloon's text box, per content kind. A kind with nothing worth saying
 * — plain lettering — is absent rather than empty, so the badge is not drawn at all.
 */
export const CONTENT_HINTS: Partial<Record<BubbleContentKind, string>> = {
  wheel:
    'Comma-delimited: each entry is one option on the wheel. Hover the bubble and scroll '
    + 'to turn it — the picker is live outside edit mode.',
  dial: DIAL,
  'dial-call':
    `${DIAL} The telephone’s green key sits at the right of the field and places the same `
    + 'call Enter does. It stays greyed until the number in the field is one that could be '
    + 'dialled.',
  input: FIELD,
  phone: FIELD,
  actions:
    'Comma-delimited: each entry is one placeholder button. They press but are wired to '
    + 'nothing yet.',
  // The two the call fills in: their `text` is the call's, not the author's.
  transcript:
    'A window over one side of the call on this panel — its role’s seat — filled from the '
    + 'call itself; the text here is ignored. Drawn only once the call is answered, so it '
    + 'is off the Ringing layout.',
  'number-hangup':
    'The number that is ringing or answered, with the telephone’s red key at the right of '
    + 'it — the dial + call button seen from the other end. Nothing to type or turn; the '
    + 'text here is ignored, and in the editor it shows what this panel’s dial is set to.',
}

export const CHAIN_HINT =
  'This balloon is one column of a conversation — its settings are below. Its shape, '
  + 'tail, rotation and lettering are the template every row on this side is stamped '
  + 'from; its placement is where that side of the table sits.'

/** Why the link picker is empty: there is nothing on this panel to link to yet. */
export function linkHint(panelLabel: string): string {
  return `Add a second bubble to ${panelLabel} to link this one — a link joins two `
    + 'bubbles on the same panel.'
}
