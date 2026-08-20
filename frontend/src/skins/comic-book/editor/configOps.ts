import { logger } from '../../../lib/logger'
import { isTailDir } from '../bubbleBox'
import { PANELS } from '../panels'
import { PANEL_ASSETS } from './assets'
import { isBubbleType } from './bubbleTypes'
import { PANEL_IMG_TRANSFORMS, PANEL_BUBBLE_TRANSFORMS } from './layoutConfig'
import type { BubbleTransform, EditorConfig, ImgTransform } from './types'

// Every change the editor makes to its working copy, as pure functions on a config.
// They live apart from useEditorMode.ts so they can be tested without React, and
// because both arrays are now editable in length: an add, a delete or a panel change
// all have to leave the `linkTo` indices consistent, which is real logic and not a
// state-hook concern.

/** localStorage key for the working copy — exported for the hook and its tests. */
export const CONFIG_KEY = 'comic-book:editConfig'

/**
 * A brand-new picture, before {@link addImg} drops it on a panel. Inset on purpose: a
 * second picture added on the panel box itself would land underneath the one already
 * there and read as nothing having happened.
 */
export const NEW_IMAGE: Omit<ImgTransform, 'panel'> = {
  src: PANEL_ASSETS[0].src,
  alt: '',
  left: 20,
  top: 20,
  width: 55,
  spill: false,
}

/** A brand-new bubble, before {@link addBubble} drops it on a panel. */
export const NEW_BUBBLE: Omit<BubbleTransform, 'panel'> = {
  top: -35,
  right: -12,
  width: 55,
  rotate: -5,
  spill: true,
  type: 'soft',
  tail: 'down-left',
  text: 'New bubble',
  linkTo: null,
  hoverType: null,
  clickType: null,
}

/** Deep clone of the on-disk constants — the canonical "default" config. */
export function seedConfig(): EditorConfig {
  return {
    images: PANEL_IMG_TRANSFORMS.map(t => ({ ...t })),
    bubbles: PANEL_BUBBLE_TRANSFORMS.map(b => ({ ...b })),
  }
}

/** Deep clone of an arbitrary config (no shared references with the input). */
export function cloneConfig(c: EditorConfig): EditorConfig {
  return {
    images: c.images.map(t => ({ ...t })),
    bubbles: c.bubbles.map(b => ({ ...b })),
  }
}

/**
 * Drop every link that can no longer be drawn: out of range, to itself, or across
 * panels. Run after any edit that can invalidate one — a delete renumbers the array,
 * and moving a bubble to another panel strands whatever it was joined to.
 *
 * It nulls rather than repairs, because there is no repair: the author's intent was
 * to join two specific balloons, and once they are on different panels no tube
 * expresses it. Leaving the stale index would have BubbleTubes silently skip it,
 * which looks like a rendering bug rather than a config the editor undid.
 */
export function sanitizeLinks(bubbles: BubbleTransform[]): BubbleTransform[] {
  return bubbles.map((b, i) => {
    const j = b.linkTo
    if (j == null) return b
    const partner = bubbles[j]
    if (j === i || !partner || partner.panel !== b.panel) return { ...b, linkTo: null }
    return b
  })
}

/**
 * Replace every shape or tail name a bubble carries that no longer exists.
 *
 * A working copy is written against the registries of the day it was saved, and both
 * shrink: `jagged` was a fourth bubble type once, and a config still naming it came
 * back through {@link hydrateConfig} untouched — the payload is cast into
 * `BubbleTransform`, never checked against it. Every consumer then indexes a
 * `Record` with that dead name, and `SHAPES[type]` being `undefined` takes down the
 * whole page from a destructure in `ringPoints`, not just the one balloon.
 *
 * A retired resting `type` becomes `soft` — a bubble must be *some* shape, and the
 * plain ellipse is the one that asserts least about what the author meant. A retired
 * `hoverType`/`clickType` becomes `null`, which those fields already spell as "stay as
 * you are", so the bubble simply stops morphing on that event. A retired `tail` becomes
 * `'none'`, its own no-op. In each case the words, the placement and every other
 * property survive: the author loses the one attribute that no longer has a meaning.
 */
function coerceBubbleEnums(b: BubbleTransform): BubbleTransform {
  const dropped: Record<string, unknown> = {}
  const next = { ...b }
  if (!isBubbleType(next.type)) {
    dropped.type = next.type
    next.type = 'soft'
  }
  for (const field of ['hoverType', 'clickType'] as const) {
    if (next[field] !== null && !isBubbleType(next[field])) {
      dropped[field] = next[field]
      next[field] = null
    }
  }
  if (!isTailDir(next.tail)) {
    dropped.tail = next.tail
    next.tail = 'none'
  }
  if (Object.keys(dropped).length > 0) {
    logger.warn('Dropped retired comic-book bubble attributes', { key: CONFIG_KEY, dropped })
  }
  return next
}

/**
 * Pull an entry's `panel` back into the panel list. A panel index from an older
 * payload — or from a config hand-edited against a different grid — can outrun it, and
 * clamping beats an entry that renders nowhere and so cannot be selected to be fixed.
 */
function clampPanel<T extends { panel: number }>(entry: T): T {
  return { ...entry, panel: Math.min(Math.max(entry.panel, 0), PANELS.length - 1) }
}

/**
 * Build a config from a persisted JSON string. Falls back to {@link seedConfig}
 * for null, malformed JSON, or a structurally invalid payload — never throws.
 */
/**
 * The fields an image entry may carry, and the reason the payload is picked apart
 * rather than spread whole: a config saved before a picture's height was derived from
 * its source also holds `height`, `scale`, `offsetX`, `offsetY` and `anchor`. Nothing
 * reads them now, but spreading them back in would leave a working copy whose entries
 * are not ImgTransforms, and the next Save would carry the corpses forward.
 */
const IMG_FIELDS = ['panel', 'src', 'alt', 'left', 'top', 'width', 'spill'] as const

/** Keep only {@link IMG_FIELDS} from a persisted entry, dropping any retired key. */
function pickImgFields(t: Partial<ImgTransform>): Partial<ImgTransform> {
  const out: Partial<ImgTransform> = {}
  IMG_FIELDS.forEach(k => {
    if (k in t) Object.assign(out, { [k]: t[k] })
  })
  return out
}

export function hydrateConfig(raw: string | null): EditorConfig {
  if (raw == null) return seedConfig()
  try {
    const parsed = JSON.parse(raw) as Partial<EditorConfig>
    if (!parsed || !Array.isArray(parsed.images) || !Array.isArray(parsed.bubbles)) {
      return seedConfig()
    }
    // Backfill any field missing from an older payload by merging each entry over a
    // default, so an upgrade never leaves undefined. Neither array's length is checked
    // any more — both are the author's now, and a payload with nine pictures because
    // one panel holds two is the normal case, not a corrupt file.
    //
    // An image entry merges over its new-entity template *and then* over the seed entry
    // at the same index. That ordering is what makes a payload saved before pictures
    // had a panel, a src or a frame come back as the eight shipped pictures rather than
    // as eight copies of NEW_IMAGE pointing at the logo: the seed supplies the identity,
    // the payload supplies whatever framing the author had already changed, and the
    // template only fills what neither has. Beyond the seed's length there is no
    // identity to recover, and the template is the whole answer.
    //
    // A bubble merges over NEW_BUBBLE alone. Its seed entry carries the *words*, and
    // resurrecting a line the author had deleted is worse than an empty balloon.
    const seed = seedConfig()
    return {
      images: parsed.images.map((t, i) => {
        // Typed as possibly-absent because the payload may be longer than the seed:
        // a ninth picture the author added has no shipped entry to recover from, and
        // the template is then the whole answer.
        const shipped = seed.images[i] as ImgTransform | undefined
        return clampPanel({
          panel: 0,
          ...NEW_IMAGE,
          ...shipped,
          ...pickImgFields(t as Partial<ImgTransform>),
        })
      }),
      bubbles: sanitizeLinks(
        parsed.bubbles.map(b =>
          // Cast because a persisted payload predates whatever fields were added since,
          // whatever the declared type says it holds. `coerceBubbleEnums` is the other
          // half of that: the payload also *outlives* names that have since been
          // retired, and merging over NEW_BUBBLE cannot catch one because the field is
          // present, just no longer meaningful.
          coerceBubbleEnums(
            clampPanel({ panel: 0, ...NEW_BUBBLE, ...(b as Partial<BubbleTransform>) }),
          ),
        ),
      ),
    }
  } catch (err) {
    logger.warn('Discarding malformed comic-book editor config', {
      key: CONFIG_KEY,
      err: String(err),
    })
    return seedConfig()
  }
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
