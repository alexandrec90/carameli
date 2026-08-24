import type { PanelBgStyle } from '../panelPatterns'
import { cloneConfig, NEW_BUBBLE, NEW_IMAGE, seedConfig } from './configSeed'
import { sanitizeLinks } from './configHydrate'
import type { BubbleTransform, EditorConfig, ImgTransform } from './types'

// Every change the editor makes to its working copy, as pure functions on a config.
// They live apart from useEditorMode.ts so they can be tested without React, and
// because both arrays are now editable in length: an add, a delete or a panel change
// all have to leave the `linkTo` indices consistent, which is real logic and not a
// state-hook concern.
//
// The defaults and the clone are in ./configSeed.ts, reading a saved payload back is in
// ./configHydrate.ts, and the grid edits a shape gesture makes are in ./panelGridOps.ts.
// All four are re-exported from here, so a caller still has one module to import from.

export { CONFIG_KEY, NEW_BUBBLE, NEW_IMAGE, cloneConfig, resetGrid, seedConfig, setGrid } from './configSeed'
export { hydrateConfig, sanitizeLinks } from './configHydrate'

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
  if (next.images[index]) next.images[index] = { ...next.images[index], ...patch }
  return next
}

/**
 * Patch-merge a single bubble entry, returning a new config. Links are re-checked
 * afterwards: `panel` is one of the fields a patch can carry, and changing it is
 * exactly the edit that can orphan a link.
 */
export function patchBubble(
  config: EditorConfig,
  index: number,
  patch: Partial<BubbleTransform>,
): EditorConfig {
  const next = cloneConfig(config)
  if (!next.bubbles[index]) return next
  next.bubbles[index] = { ...next.bubbles[index], ...patch }
  next.bubbles = sanitizeLinks(next.bubbles)
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
 * Remove bubble `index`, returning a new config. Every later bubble shifts down one,
 * so links are renumbered to follow — a link is to a bubble, not to a slot, and
 * leaving the raw indices would silently re-point half of them at their neighbours.
 */
export function removeBubble(config: EditorConfig, index: number): EditorConfig {
  const next = cloneConfig(config)
  if (!next.bubbles[index]) return next
  next.bubbles.splice(index, 1)
  next.bubbles = sanitizeLinks(
    next.bubbles.map(b => {
      if (b.linkTo == null) return b
      if (b.linkTo === index) return { ...b, linkTo: null }
      return b.linkTo > index ? { ...b, linkTo: b.linkTo - 1 } : b
    }),
  )
  return next
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
    next.bubbles = sanitizeLinks(next.bubbles)
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
 * Bubbles bubble `index` may link to: the others on its own panel, and no more. This
 * is where the same-panel rule is enforced for the author — the dropdown simply never
 * offers a cross-panel partner, so the invalid state is unreachable rather than
 * validated after the fact.
 */
export function linkCandidates(bubbles: { panel: number }[], index: number): number[] {
  const self = bubbles[index]
  if (!self) return []
  return indicesOnPanel(bubbles, self.panel).filter(i => i !== index)
}
