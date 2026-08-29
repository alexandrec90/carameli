import type { CallSpeaker } from '../../lib/callTranscript'

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
