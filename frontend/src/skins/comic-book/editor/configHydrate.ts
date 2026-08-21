import { logger } from '../../../lib/logger'
import { isTailDir } from '../bubbleBox'
import { PANELS } from '../panels'
import { isPanelBgStyle } from '../panelPatterns'
import type { PanelBgStyle } from '../panelPatterns'
import { isBubbleType } from './bubbleTypes'
import { CONFIG_KEY, NEW_BUBBLE, NEW_IMAGE, sanitizeLinks, seedConfig } from './configOps'
import { PANEL_PATTERNS } from './layoutConfig'
import type { BubbleTransform, EditorConfig, ImgTransform } from './types'

// Rebuilding a working copy from whatever localStorage holds. Persisted payloads
// outlive the code that wrote them — fields appear, registries shrink, the grid
// changes shape — so everything here is defensive by construction: fill what is
// missing, coerce what is retired, clamp what is out of range, and never throw.
// The pure edit operations live in ./configOps.ts.

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
 * A PANELS-length pattern array from whatever a payload carried. Per-slot: a name the
 * registry still knows survives, anything else — a retired style, a typo, a missing
 * entry from a payload saved before patterns existed — falls back to that slot's
 * shipped default. Length is forced to PANELS.length both ways, because the array is
 * parallel by contract and every consumer indexes it by panel number.
 */
export function normalizePatterns(raw: unknown): PanelBgStyle[] {
  const src = Array.isArray(raw) ? raw : []
  const dropped: Record<number, unknown> = {}
  const out = PANEL_PATTERNS.map((shipped, i) => {
    if (isPanelBgStyle(src[i])) return src[i]
    if (src[i] !== undefined) dropped[i] = src[i]
    return shipped
  })
  if (Object.keys(dropped).length > 0) {
    logger.warn('Dropped retired comic-book pattern styles', { key: CONFIG_KEY, dropped })
  }
  return out
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
      // Absence is not corruption: a payload saved before patterns existed has no
      // `patterns` key at all, and its images and bubbles are still the author's.
      patterns: normalizePatterns(parsed.patterns),
    }
  } catch (err) {
    logger.warn('Discarding malformed comic-book editor config', {
      key: CONFIG_KEY,
      err: String(err),
    })
    return seedConfig()
  }
}
