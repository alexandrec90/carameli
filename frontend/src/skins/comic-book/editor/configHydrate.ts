import { logger } from '../../../lib/logger'
import { isTailDir } from '../bubbleBox'
import { PANELS } from '../panels'
import { isBubbleContentKind } from '../wheelPicker'
import { isBubbleType } from './bubbleTypes'
import { CONFIG_KEY, cloneGrids, NEW_BUBBLE, NEW_IMAGE, seedConfig } from './configSeed'
import { isPanelGrids } from './panelGridValidate'
import type { BubbleTransform, EditorConfig, ImgTransform } from './types'

// Reading a persisted working copy back. Everything here exists because a payload
// outlives the code that wrote it: fields get added, names get retired, and a saved
// config has to come back as a page either way.

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
 * `'none'`, its own no-op. A retired `content` kind becomes `'text'` — the words are
 * still there, just lettered plainly. In each case the words, the placement and every
 * other property survive: the author loses the one attribute that no longer has a
 * meaning.
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
  if (!isBubbleContentKind(next.content)) {
    dropped.content = next.content
    next.content = 'text'
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
    //
    // `grids` gets neither treatment: it is taken whole or not at all. There is no
    // field-by-field backfill for a subdivision — a payload with a ring naming a vertex
    // that isn't there cannot be repaired into a page, only into a differently broken
    // one — so a payload that fails the structural guard falls back to the shipped
    // grids and the author's pictures and words survive around them.
    const seed = seedConfig()
    return {
      grids: isPanelGrids(parsed.grids, PANELS.length) ? cloneGrids(parsed.grids) : seed.grids,
      images: parsed.images.map((t, i) => {
        // Typed as possibly-absent because the payload may be longer than the seed:
        // a ninth picture the author added has no shipped entry to recover from, and
        // the template is then the whole answer.
        const shipped = seed.images[i] as ImgTransform | undefined
        return clampPanel({
          panel: 0,
          ...NEW_IMAGE,
          ...shipped,
          ...(t as Partial<ImgTransform>),
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
