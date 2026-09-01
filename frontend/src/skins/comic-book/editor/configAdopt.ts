import { cloneCallScene } from './callSceneOps'
import { cloneConfig, cloneImg } from './configSeed'
import { reconcile } from './reconcile'
import type { BubbleTransform, EditorConfig, ImgTransform } from './types'

// Taking the file's version of one panel into a working copy, without discarding the rest
// of the tab's work.
//
// Until this existed the editor had exactly two answers to "layoutConfig.ts has moved
// under this tab": Save, which reverts whatever moved it, and Reset, which throws away
// everything the tab has done. Every real occurrence needed neither — the file had gained
// a feature on one panel while the author was reframing a different one — so the merge was
// done by hand in git, four times, each time costing a session that had to work out from
// a diff which side of it was whose. ./configDrift.ts names the panels; this takes them.
//
// **A panel is the unit because a panel is self-contained.** A tube's two ends share a
// panel and the renderer refuses a link across one; a chain is filtered to a single panel;
// a call scene is keyed by panel. So the entries on one panel can be lifted out and
// replaced without anything on another panel losing the thing it pointed at — which is not
// true of any smaller unit, and is why there is no "adopt this balloon".

/** An entry on its way into the merged list, and where it came from. */
interface Sourced<T> {
  entry: T
  /** Index in the array it came from, so a link can be followed to its new home. */
  from: number
  fromSeed: boolean
}

/**
 * Replace every entry on `panel` with the incoming ones, in place: the file's version of
 * the panel lands where the copy's version was, so nothing else on the page moves further
 * than the difference in count.
 *
 * Position matters even though neither array is parallel to anything. `linkTo` is an index
 * into the bubble list, so the whole list is renumbered by this and the links have to be
 * carried across — which is what the returned sources are for.
 */
function splicePanel<T extends { panel: number }>(
  current: readonly T[],
  incoming: readonly T[],
  panel: number,
): Sourced<T>[] {
  const out: Sourced<T>[] = []
  let placed = false
  const place = () => {
    placed = true
    incoming.forEach((entry, from) => out.push({ entry, from, fromSeed: true }))
  }
  current.forEach((entry, from) => {
    if (entry.panel === panel) {
      if (!placed) place()
      return
    }
    out.push({ entry, from, fromSeed: false })
  })
  // A panel the copy has nothing on yet — the file added its first picture — puts the
  // incoming entries at the end, which is where an append has always put them.
  if (!placed) place()
  return out
}

/**
 * Where each entry ended up, by origin. Two maps rather than one because an index means
 * nothing without the array it indexes: bubble 4 of the working copy and bubble 4 of the
 * file are unrelated, and a single map would silently conflate them.
 */
function newIndices(sources: Sourced<unknown>[]): { copy: Map<number, number>; seed: Map<number, number> } {
  const copy = new Map<number, number>()
  const seed = new Map<number, number>()
  sources.forEach((s, to) => (s.fromSeed ? seed : copy).set(s.from, to))
  return { copy, seed }
}

/**
 * Re-aim one balloon's `linkTo` at wherever its partner landed. A partner that is not in
 * the merged list at all — a link inside the panel being replaced — is nulled here rather
 * than left dangling; `reconcile` would drop it anyway, and leaving a stale index for it to
 * find means the intermediate list is briefly one where `linkTo` points at a stranger.
 */
function remapLink(
  bubble: BubbleTransform,
  fromSeed: boolean,
  maps: { copy: Map<number, number>; seed: Map<number, number> },
): BubbleTransform {
  if (bubble.linkTo === null) return bubble
  const found = (fromSeed ? maps.seed : maps.copy).get(bubble.linkTo)
  return { ...bubble, linkTo: found ?? null }
}

/**
 * Take the file's version of one panel into `config`: its pictures, its balloons, its name,
 * its background pattern and its call seam. Everything on every other panel is the working
 * copy's and is left exactly as it is.
 *
 * The derived halves are settled by {@link reconcile} rather than carried: `chains` and
 * `callScenes` are functions of the entries, so adopting the entries adopts them. The one
 * thing that is *not* implied — the seam's position and axis — is copied across first, so
 * `syncCallScenes` finds it and keeps it instead of centring a fresh cut.
 *
 * A panel index the file does not have is a no-op: there is nothing to adopt.
 */
export function adoptPanel(config: EditorConfig, seed: EditorConfig, panel: number): EditorConfig {
  if (panel < 0 || panel >= seed.panels.length) return config
  const next = cloneConfig(config)

  const imgs = splicePanel<ImgTransform>(next.images, seed.images, panel)
  next.images = imgs.map(s => cloneImg(s.entry))

  const bubbles = splicePanel<BubbleTransform>(next.bubbles, seed.bubbles, panel)
  const maps = newIndices(bubbles)
  next.bubbles = bubbles.map(s => remapLink({ ...s.entry }, s.fromSeed, maps))

  // The panel slot itself. `panels` is parallel to `patterns` and to every grid's ring
  // table, so this writes the slot in place and never appends — a panel the copy does not
  // have is the page-level change ./configDrift.ts reports and this does not attempt.
  if (panel < next.panels.length) next.panels[panel] = { ...seed.panels[panel] }
  if (panel < next.patterns.length) next.patterns[panel] = seed.patterns[panel]

  const seam = seed.callScenes.find(s => s.panel === panel)
  next.callScenes = next.callScenes.filter(s => s.panel !== panel)
  if (seam) next.callScenes.push(cloneCallScene(seam))

  return reconcile(next)
}
