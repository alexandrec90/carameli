import { logger } from '../../../lib/logger'
import { isTailDir } from '../bubbleBox'
import { isBubbleContentKind } from '../bubbleContent'
import { isPanelBgStyle, PATTERN_STYLE_KEYS } from '../panelPatterns'
import type { PanelBgStyle } from '../panelPatterns'
import { isBubbleType } from './bubbleTypes'
import { hydrateChains, normalizeChainId, propagateChains, syncChains } from './chainOps'
import { isPanelList } from './configPanels'
import { CONFIG_KEY, cloneGrids, NEW_BUBBLE, NEW_IMAGE, seedConfig } from './configSeed'
import { PANEL_PATTERNS, PANELS } from './layoutConfig'
import { coerceNumberPad } from './numberPadValidate'
import { isPageGrids } from './panelGridValidate'
import { coerceTable } from './tableValidate'
import type { BubbleTransform, EditorConfig, ImgTransform } from './types'

// Reading a persisted working copy back. Everything here exists because a payload
// outlives the code that wrote it: fields get added, names get retired, and a saved
// config has to come back as a page either way.

/**
 * Drop every link that can no longer mean anything: out of range, to itself, or across
 * panels. Run after any edit that can invalidate one — a delete renumbers the array, and
 * moving a bubble to another panel strands whatever it was joined to.
 *
 * It nulls rather than repairs, because there is no repair: the author's intent was
 * to join two specific balloons, and once they are on different panels nothing
 * expresses it. Leaving the stale index would have BubbleTubes silently skip it,
 * which looks like a rendering bug rather than a config the editor undid — and would
 * leave `propagateChains` joining two panels' balloons into one column.
 *
 * A link with an end in a chain used to be nulled here too, back when a chain was a name
 * typed on a balloon and a tube was the only thing a link could mean. Linkage is now what
 * *builds* a chain, so nulling those is exactly backwards; what the two readings of a
 * link share is this function's rule that both ends be real and on one panel, and they
 * are told apart downstream — `linkedPairs` draws no tube across a chained group.
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
  // Not a registry lookup like the others — any name is a valid chain — but a payload
  // can still carry a non-string here, and one would join no chain while comparing
  // unequal to '', which reads as a bubble that has vanished from its column.
  next.chain = typeof next.chain === 'string' ? normalizeChainId(next.chain) : ''
  if (Object.keys(dropped).length > 0) {
    logger.warn('Dropped retired comic-book bubble attributes', { key: CONFIG_KEY, dropped })
  }
  return next
}

/**
 * The pattern array a payload carries, coerced back to one style per panel slot.
 *
 * Parallel to the panel list, so the length is not the author's: it is `count` — the
 * payload's own panel count once that has been settled, the shipped list's by default.
 * A short array (saved before a panel existed) backfills from the shipped defaults, a
 * long one is cut, and a slot naming a style that has since been retired — or was never
 * one — falls back to its shipped default rather than failing the draw. A slot past the
 * shipped list has no shipped default and takes the first registered style. The style
 * name is the whole entry, so unlike a bubble there is nothing else to save around it.
 */
export function normalizePatterns(raw: unknown, count: number = PANELS.length): PanelBgStyle[] {
  const list = Array.isArray(raw) ? raw : []
  const dropped: Record<number, unknown> = {}
  const out: PanelBgStyle[] = []
  for (let i = 0; i < count; i++) {
    const shipped = PANEL_PATTERNS[i] ?? PATTERN_STYLE_KEYS[0]
    const candidate = list[i]
    if (candidate === undefined) {
      out.push(shipped)
    } else if (isPanelBgStyle(candidate)) {
      out.push(candidate)
    } else {
      dropped[i] = candidate
      out.push(shipped)
    }
  }
  if (Object.keys(dropped).length > 0) {
    logger.warn('Dropped retired comic-book pattern styles', { key: CONFIG_KEY, dropped })
  }
  return out
}

/**
 * Pull an entry's `panel` back into the panel list of `count` panels. A panel index
 * from an older payload — or from a config hand-edited against a different grid — can
 * outrun it, and clamping beats an entry that renders nowhere and so cannot be selected
 * to be fixed.
 */
function clampPanel<T extends { panel: number }>(entry: T, count: number): T {
  return { ...entry, panel: Math.min(Math.max(entry.panel, 0), count - 1) }
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
    //
    // `panels` goes with the grids, together or not at all: every ring table is
    // panels-length, so a list the grids do not match — one hand-edited without the
    // other — cannot be repaired into a page either. A payload from before the list was
    // saved has no `panels` and checks its grids against the shipped list, as it always
    // did; one that has both keeps both, including any panel a split appended.
    const seed = seedConfig()
    const savedPanels = isPanelList(parsed.panels)
      ? parsed.panels.map(p => ({ label: p.label, isLogo: p.isLogo, page: p.page }))
      : seed.panels
    const savedGrids = isPageGrids(parsed.grids, savedPanels.length) ? cloneGrids(parsed.grids) : null
    const panels = savedGrids ? savedPanels : seed.panels
    const grids = savedGrids ?? seed.grids
    const count = panels.length
    const bubbles = propagateChains(sanitizeLinks(
      parsed.bubbles.map(b =>
        // Cast because a persisted payload predates whatever fields were added since,
        // whatever the declared type says it holds. `coerceBubbleEnums` is the other
        // half of that: the payload also *outlives* names that have since been
        // retired, and merging over NEW_BUBBLE cannot catch one because the field is
        // present, just no longer meaningful.
        coerceBubbleEnums(
          clampPanel({ panel: 0, ...NEW_BUBBLE, ...(b as Partial<BubbleTransform>) }, count),
        ),
      ),
    ))
    return {
      panels,
      grids,
      patterns: normalizePatterns(parsed.patterns, count),
      images: parsed.images.map((t, i) => {
        // Typed as possibly-absent because the payload may be longer than the seed:
        // a ninth picture the author added has no shipped entry to recover from, and
        // the template is then the whole answer.
        const shipped = seed.images[i] as ImgTransform | undefined
        const merged = clampPanel({
          panel: 0,
          ...NEW_IMAGE,
          ...shipped,
          ...(t as Partial<ImgTransform>),
        }, count)
        // Projected content is nested, so a payload written before a field existed — or
        // with a cell that came back as a number — needs repair inside rather than a
        // whole-value merge. Each coercer returns undefined for the ordinary case of a
        // picture that is not that surface, and absent keys stay absent.
        const table = coerceTable(merged.table)
        const numberPad = coerceNumberPad(merged.numberPad)
        const plain = { ...merged }
        delete plain.table
        delete plain.numberPad
        // Existing table payloads win if a hand-edited config names both. The editor
        // presents one projected-content choice and never writes the ambiguous state.
        if (table) return { ...plain, table }
        if (numberPad) return { ...plain, numberPad }
        return plain
      }),
      bubbles,
      // Rebuilt from the bubbles rather than trusted: the list is derived, so a payload
      // written before chains existed, one hand-edited into naming a chain nothing is
      // in, or one whose last member was renamed away all come back as exactly the
      // chains the balloons describe — carrying over the settings of every entry that
      // is still real.
      chains: syncChains(bubbles, hydrateChains(parsed.chains)),
    }
  } catch (err) {
    logger.warn('Discarding malformed comic-book editor config', {
      key: CONFIG_KEY,
      err: String(err),
    })
    return seedConfig()
  }
}
