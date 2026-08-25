import { chainSlots } from '../bubbleChain'
import { normalizeChainId, patchChainIn, syncChains } from './chainOps'
import type { PanelBgStyle } from '../panelPatterns'
import { cloneConfig, cloneImg, NEW_BUBBLE, NEW_IMAGE, seedConfig } from './configSeed'
import { sanitizeLinks } from './configHydrate'
import type { BubbleChain, BubbleTransform, EditorConfig, ImgTransform } from './types'

// Every change the editor makes to its working copy, as pure functions on a config.
// They live apart from useEditorMode.ts so they can be tested without React, and
// because both arrays are now editable in length: an add, a delete or a panel change
// all have to leave the `linkTo` indices consistent, which is real logic and not a
// state-hook concern.
//
// The defaults and the clone are in ./configSeed.ts, reading a saved payload back is in
// ./configHydrate.ts, and the grid edits a shape gesture makes are in ./panelGridOps.ts.
// All four are re-exported from here, so a caller still has one module to import from.
// ./chainOps.ts is the exception: the chain list is derived rather than edited, so the
// ops that maintain it are called from in here and are not part of the editor's surface.

export { CONFIG_KEY, NEW_BUBBLE, NEW_IMAGE, cloneConfig, resetGrid, seedConfig, setGrid } from './configSeed'
export { hydrateConfig, sanitizeLinks } from './configHydrate'
export { NEW_CHAIN } from './chainOps'

/**
 * Bring the derived halves of a config back into agreement with its bubbles: links that
 * no longer make sense are nulled, and the chain list is recomputed from the names the
 * bubbles carry. Every op that can touch a bubble runs this, which is what keeps "add a
 * chain" and "delete a chain" from needing to exist as operations at all.
 */
function reconcile(config: EditorConfig): EditorConfig {
  config.bubbles = sanitizeLinks(config.bubbles)
  config.chains = syncChains(config.bubbles, config.chains)
  return config
}

/**
 * Vertical gap, in % of the panel box, between one chain slot and the next when the
 * editor adds one. A starting point for a drag, not a layout rule — the slots are the
 * author's drawing, and nothing re-spaces them afterwards.
 */
const CHAIN_SLOT_GAP = 28

/**
 * Set one panel slot's background pattern, returning a new config. `patterns` is
 * parallel to PANELS, so unlike the two entry arrays there is nothing to append or
 * splice — an out-of-range index is a no-op rather than a growth.
 */
export function patchPattern(config: EditorConfig, panel: number, style: PanelBgStyle): EditorConfig {
  const next = cloneConfig(config)
  if (panel >= 0 && panel < next.patterns.length) next.patterns[panel] = style
  return next
}

/** Patch-merge a single image entry, returning a new config. */
export function patchImg(
  config: EditorConfig,
  index: number,
  patch: Partial<ImgTransform>,
): EditorConfig {
  const next = cloneConfig(config)
  if (next.images[index]) next.images[index] = cloneImg({ ...next.images[index], ...patch })
  return next
}

/**
 * Patch-merge a single bubble entry, returning a new config. Links and chains are
 * re-derived afterwards: `panel` is one of the fields a patch can carry and changing it
 * is exactly the edit that can orphan a link, and `chain` is the field the whole chain
 * list is a function of.
 */
export function patchBubble(
  config: EditorConfig,
  index: number,
  patch: Partial<BubbleTransform>,
): EditorConfig {
  const next = cloneConfig(config)
  if (!next.bubbles[index]) return next
  const merged = { ...next.bubbles[index], ...patch }
  // Normalised here, not in the inspector, so a name typed with a stray trailing space
  // joins the chain the author meant rather than starting a second one beside it.
  if (patch.chain !== undefined) merged.chain = normalizeChainId(merged.chain)
  next.bubbles[index] = merged
  return reconcile(next)
}

/**
 * Patch-merge one chain's settings by id, returning a new config. There is no add or
 * remove counterpart: the list follows the bubbles (see {@link reconcile}).
 */
export function patchChain(
  config: EditorConfig,
  id: string,
  patch: Partial<BubbleChain>,
): EditorConfig {
  const next = cloneConfig(config)
  next.chains = patchChainIn(next.chains, id, patch)
  return next
}

/** Append a picture on `panel`, returning the new config and the new picture's index. */
export function addImg(
  config: EditorConfig,
  panel: number,
): { config: EditorConfig; index: number } {
  const next = cloneConfig(config)
  next.images.push({ ...NEW_IMAGE, panel })
  return { config: next, index: next.images.length - 1 }
}

/**
 * Remove picture `index`, returning a new config. Nothing refers to a picture by index
 * the way a bubble's `linkTo` refers to a bubble, so this is the plain splice its
 * counterpart cannot be.
 */
export function removeImg(config: EditorConfig, index: number): EditorConfig {
  const next = cloneConfig(config)
  if (!next.images[index]) return next
  next.images.splice(index, 1)
  return next
}

/** Append a bubble on `panel`, returning the new config and the new bubble's index. */
export function addBubble(
  config: EditorConfig,
  panel: number,
): { config: EditorConfig; index: number } {
  const next = cloneConfig(config)
  next.bubbles.push({ ...NEW_BUBBLE, panel })
  return { config: next, index: next.bubbles.length - 1 }
}

/**
 * Append a bubble as the newest slot of `chain` on `panel` — one column-height higher
 * than the chain's current top, so it lands where the next balloon of that thread goes
 * rather than on top of the root. A chain with no members yet gets the plain new-bubble
 * placement, and only the root carries a tail: every later slot is the same speaker
 * still talking, and a column of tails reads as a crowd.
 */
export function addChainBubble(
  config: EditorConfig,
  panel: number,
  chain: string,
): { config: EditorConfig; index: number } {
  const next = cloneConfig(config)
  const id = normalizeChainId(chain)
  const slots = chainSlots(next.bubbles, id, panel)
  const top = slots.length > 0 ? next.bubbles[slots[slots.length - 1]] : null
  next.bubbles.push({
    ...NEW_BUBBLE,
    panel,
    chain: id,
    ...(top
      ? { top: top.top - CHAIN_SLOT_GAP, right: top.right, width: top.width, tail: 'none' }
      : {}),
  })
  return { config: reconcile(next), index: next.bubbles.length - 1 }
}

/**
 * Remove bubble `index`, returning a new config. Every later bubble shifts down one,
 * so links are renumbered to follow — a link is to a bubble, not to a slot, and
 * leaving the raw indices would silently re-point half of them at their neighbours.
 */
export function removeBubble(config: EditorConfig, index: number): EditorConfig {
  const next = cloneConfig(config)
  if (!next.bubbles[index]) return next
  next.bubbles.splice(index, 1)
  next.bubbles = next.bubbles.map(b => {
    if (b.linkTo == null) return b
    if (b.linkTo === index) return { ...b, linkTo: null }
    return b.linkTo > index ? { ...b, linkTo: b.linkTo - 1 } : b
  })
  return reconcile(next)
}

/**
 * Restore a single entry to its constant default, returning a new config. An entry the
 * author added has no default to go back to, so it is left alone — deleting it is the
 * delete button's job, not reset's.
 */
export function resetOneIn(
  config: EditorConfig,
  kind: 'img' | 'bubble',
  index: number,
): EditorConfig {
  const next = cloneConfig(config)
  const seed = seedConfig()
  if (kind === 'img' && seed.images[index]) next.images[index] = seed.images[index]
  if (kind === 'bubble' && seed.bubbles[index]) {
    next.bubbles[index] = seed.bubbles[index]
    return reconcile(next)
  }
  return next
}

/**
 * Indices of the entries belonging to `panel`, in array order. Works on either array —
 * `panel` is the only field it reads, and it is the field both kinds now carry.
 */
export function indicesOnPanel(entries: { panel: number }[], panel: number): number[] {
  return entries.reduce<number[]>((acc, e, i) => {
    if (e.panel === panel) acc.push(i)
    return acc
  }, [])
}

/**
 * Bubbles bubble `index` may link to: the unchained others on its own panel, and no
 * more. This is where the same-panel and no-chained-ends rules are enforced for the
 * author — the dropdown simply never offers an invalid partner, so the invalid state is
 * unreachable rather than validated after the fact. A chained bubble has no candidates
 * at all, which greys the picker out; `sanitizeLinks` says why.
 */
export function linkCandidates(bubbles: { panel: number; chain: string }[], index: number): number[] {
  const self = bubbles[index]
  if (!self || self.chain) return []
  return indicesOnPanel(bubbles, self.panel).filter(i => i !== index && !bubbles[i].chain)
}
