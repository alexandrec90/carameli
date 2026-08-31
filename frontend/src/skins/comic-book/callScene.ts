import type { CallSpeaker, CallTranscript } from '../../lib/callTranscript'

/** What the call scene shows in each half: the far end's two states, and the caller. */
export type CallSceneFigure = 'ringing' | CallSpeaker

/**
 * The scene's pictures, served from `public/comic-book/` like every other panel asset.
 * Not panel art — no layout draws them and the `index.html` guard must not preload
 * them — but a visit that places a call fetches them, which is what `assetPolicy.test.ts`
 * charges to the page holding the telephone.
 */
export const CALL_SCENE_ART: Readonly<Record<CallSceneFigure, string>> = {
  ringing: '/comic-book/ringing-phone.webp',
  remote: '/comic-book/cheating-man.webp',
  local: '/comic-book/despondent-wife.webp',
}

/** Alt text per figure: the pictures carry the call's state, so they are not decorative. */
export const CALL_SCENE_ALT: Readonly<Record<CallSceneFigure, string>> = {
  ringing: 'A telephone ringing at the far end',
  remote: 'The man who answered',
  local: 'The woman placing the call',
}

/**
 * The words the editor letters into a transcript balloon while an author lays a call
 * layout out. A balloon with nothing in it is a balloon that cannot be framed: what the
 * sample is for is that the box wraps, fills and overflows the way a real call's will.
 *
 * Comic dialogue, and deliberately nothing shaped like a telephone number or a customer's
 * name. This string is in the production bundle, and sample data that reads as real data
 * is how a placeholder ends up being quoted back as fact.
 */
export const EDITOR_CALL_TRANSCRIPT: CallTranscript = {
  lines: [
    { id: 'sample-1', speaker: 'local', text: 'Is that you? You sound so far away.' },
    { id: 'sample-2', speaker: 'remote', text: "It's the line. It always does this." },
    { id: 'sample-3', speaker: 'local', text: 'You told me you were out of town.' },
    { id: 'sample-4', speaker: 'remote', text: 'I am! I can barely hear a word.' },
  ],
  speaking: 'remote',
}
