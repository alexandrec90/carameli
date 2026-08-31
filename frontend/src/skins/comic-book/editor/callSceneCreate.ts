import { callSceneOn } from '../callSceneRoles'
import { cloneConfig, newCallArt, NEW_CALL_END_KEY, NEW_CALL_TRANSCRIPT } from './configSeed'
import { reconcile } from './reconcile'
import type { EditorConfig } from './types'

// Turning a panel into a phone call, as one op rather than as six edits the author has to
// get right in order — the same argument chainCreate.ts makes about a conversation, and
// for the same reason: none of the six couplings is visible in the result.

/**
 * Make `panel` a phone call: the three figures, the two transcripts and the red key, each
 * an ordinary picture or balloon carrying a {@link CallRole}, and the seam they are framed
 * against.
 *
 * Six entries and no more, because a call *is* those six: the far end before it picks up
 * and after, the caller who is there throughout, a balloon for each party's words, and one
 * key to hang up with. Every one of them is an ordinary entry from here on — selected,
 * dragged, resized, retyped, given another picture or deleted — which is the whole point
 * of the scene being made of them rather than drawn by a component of its own.
 *
 * The seam is **not** set here. `reconcile` derives the scene list from the roles these
 * entries carry, so the centred default arrives with them; setting it separately would be
 * a second place for the same fact to live, and the one that could disagree.
 *
 * Adding a call to a panel that already has one is refused rather than doubled: a panel is
 * cut in two once, and a second set of figures would stack invisibly on the first. The
 * returned index is then the picture already there, so the author is shown what they asked
 * for instead of nothing happening.
 */
export function addCallScene(
  config: EditorConfig,
  panel: number,
): { config: EditorConfig; index: number } {
  if (callSceneOn(config.callScenes, panel)) {
    const found = config.images.findIndex(img => img.panel === panel && img.call !== undefined)
    return { config, index: found }
  }
  const next = cloneConfig(config)
  const first = next.images.length
  next.images.push({ ...newCallArt('ringing'), panel })
  next.images.push({ ...newCallArt('remote'), panel })
  next.images.push({ ...newCallArt('local'), panel })
  next.bubbles.push({ ...NEW_CALL_TRANSCRIPT, panel, call: 'remote' })
  next.bubbles.push({ ...NEW_CALL_TRANSCRIPT, panel, call: 'local' })
  next.bubbles.push({ ...NEW_CALL_END_KEY, panel, call: 'local' })
  return { config: reconcile(next), index: first }
}
