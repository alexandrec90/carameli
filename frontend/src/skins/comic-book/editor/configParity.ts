import { LIVE_TABLE_FEEDS } from '../../../lib/liveTables'
import { linkedPairs } from '../bubbleTube'
import type { Panel } from '../panels'
import type { BubbleTransform, ImgTransform } from './types'

// What has to be true of *any* layout, as opposed to what happens to be true of the one
// shipped today. That distinction is the whole of this module.
//
// `comicBookTransforms.test.ts` has always asserted both kinds side by side, and the two
// behave completely differently under an author's hands. Reframing a picture, nudging a
// balloon off the shared placement, choosing which panels speak — those are the editor
// working, and a test pinning them is a test saying "this change was deliberate". A
// balloon with no tail and no morph targets is not an authoring choice at all: it is the
// half-built state `+ Bubble` drops on the page, and it draws a mute balloon that never
// answers a pointer.
//
// Only the second kind lives here, because only the second kind can be judged without
// knowing which layout is being looked at. That is what makes it usable from two places
// at once — the editor runs it on the working copy and shows what is still unfinished,
// and the parity test runs it on the shipped file — with no chance of the two drifting
// apart into different opinions about what "finished" means.
//
// Why it was worth extracting: the dev server writes `layoutConfig.ts` on every Save, so
// a browser tab abandoned mid-design leaves a half-built layout in whatever tree served
// it. Those failures belong to nobody's change, and the next person to run the suite
// there cannot tell them from their own work — which has now cost four separate sessions
// a diagnosis. A named violation is the difference between "someone left the editor open"
// and five assertions about tails.

/** One thing that is unfinished about a layout, in the vocabulary of the editor's controls. */
export interface LayoutViolation {
  /** Which entry — `bubble 12`, `picture 3` — with enough of it to find on the page. */
  where: string
  /** What is wrong with it, phrased the way the author would go and fix it. */
  problem: string
}

/** Served panel art lives here and nowhere else — Hard Rule 10 in the skin's rule file. */
const ASSET_PREFIX = '/comic-book/'

/**
 * A balloon whose `content` is not `text` is a **field** drawn onto the art — a number
 * typed onto a photographed handset, a wheel of options to pick from. It is placed where
 * the art puts it, points at nothing and does not morph under the pointer, so none of the
 * caption rules below say anything about it.
 *
 * A balloon in a chain is the same exception for the same reason: it is a template the
 * live thread stamps rather than one speaker's line, so it holds no tail of its own and
 * morphing one copy of it would say nothing about the message inside.
 */
function isCaption(b: BubbleTransform): boolean {
  return b.content === 'text' && b.chain === ''
}

// The panel count comes from the layout being judged rather than from the shipped
// `PANELS`: splitting a panel appends one to the working copy, and reading the count off
// the shipped constant would report every balloon on the new panel as sitting on a panel
// that does not exist.
function panelProblem(panel: number, panelCount: number): string | null {
  if (Number.isInteger(panel) && panel >= 0 && panel < panelCount) return null
  return `sits on panel ${panel}, which is not one of the ${panelCount} panels`
}

function bubbleViolations(bubbles: BubbleTransform[], panelCount: number): LayoutViolation[] {
  const out: LayoutViolation[] = []

  // Only the *second* end of a linked pair may go without a tail: a tube is one
  // speaker's line continuing across two balloons, so the pair carries one tail between
  // them and the tube is what joins the other end to it.
  const tailless = new Set(linkedPairs(bubbles).map(([, j]) => j))

  bubbles.forEach((b, i) => {
    const where = b.text ? `bubble ${i} (“${b.text}”)` : `bubble ${i}`
    const add = (problem: string) => out.push({ where, problem })

    const panel = panelProblem(b.panel, panelCount)
    if (panel) add(panel)
    if (!(b.width > 0)) add('has no width, so it draws nothing')

    // A link the renderer silently drops is worse than no link: the author drew a tube
    // in the editor and the page shows none, with nothing anywhere saying why.
    if (b.linkTo !== null) {
      if (b.linkTo === i) add('is linked to itself')
      else if (b.linkTo < 0 || b.linkTo >= bubbles.length) {
        add(`is linked to bubble ${b.linkTo}, which does not exist`)
      } else if (bubbles[b.linkTo].panel !== b.panel) {
        add(`is linked across panels to bubble ${b.linkTo}, and no tube is drawn for that`)
      }
    }

    if (!isCaption(b)) return

    if (b.text.length === 0) add('is a caption with nothing to say')
    if (!tailless.has(i) && b.tail === 'none') {
      add('has no tail, so nothing on the page says who is speaking')
    }
    if (b.hoverType === null) add('has no hover shape, so it does not answer the pointer')
    else if (b.hoverType === b.type) add('morphs to its own resting shape on hover, which reads as nothing happening')
    if (b.clickType === null) add('has no click shape, so it does not answer a press')
    else if (b.clickType === b.type) add('morphs to its own resting shape on click, which reads as nothing happening')
  })

  return out
}

function pictureViolations(images: ImgTransform[], panelCount: number): LayoutViolation[] {
  const out: LayoutViolation[] = []

  images.forEach((t, i) => {
    const where = `picture ${i} (${t.src})`
    const add = (problem: string) => out.push({ where, problem })

    const panel = panelProblem(t.panel, panelCount)
    if (panel) add(panel)

    // The frame and the framing *inside* it are two independent transforms, and a zero
    // or negative extent in either draws an empty rectangle rather than a small picture.
    if (!(t.width > 0) || !(t.height > 0)) add('has a frame with no extent, so none of it is on screen')
    if (!(t.scale > 0)) add(`is scaled to ${t.scale}, which draws nothing`)

    if (!t.src.startsWith(ASSET_PREFIX)) add(`is not served from ${ASSET_PREFIX}`)
    if (t.table && t.numberPad) {
      add('carries both a table and a number pad; a picture has one projected surface')
    }

    // A feed's cells are positional: `lib/liveTables.ts` emits them in the order that
    // feed declares its columns, and the surface draws them under whatever headings it
    // holds. So the *count* is the feed's, not the author's — the inspector will not let
    // one be added or removed while a source is on — and a surface holding any other
    // number labels every value past the first with a heading for a different one, or
    // (as here, when it holds more) leaves the tail of the row blank.
    //
    // The wording and the widths stay unjudged on purpose: renaming a heading and
    // re-proportioning it to the ruling in the photograph are exactly what an author is
    // for. This catches the one way the two lists come apart without anyone choosing it —
    // a Save from a tab opened before the feed's shape changed, which writes the old
    // column list back over the new one and reads afterwards as the feed having been
    // reverted. That is not hypothetical: it is what happened to the call-records table
    // between #274 and #287, and nothing anywhere went red.
    const source = t.table?.source
    if (source) {
      const feed = LIVE_TABLE_FEEDS[source]
      const held = t.table?.columns.length ?? 0
      if (held !== feed.columns.length) {
        add(
          `is wired to ${feed.label.toLowerCase()} but holds ${held} columns for that feed's `
          + `${feed.columns.length} values, so its headings do not name its cells`,
        )
      }
    }
  })

  return out
}

/**
 * Everything unfinished about a layout, pictures first. Takes the three arrays rather than
 * an `EditorConfig` so the parity test can hand it the shipped constants directly and the
 * editor can hand it the working copy, with neither having to build the other's shape.
 * `panels` is only read for its length — it is what "panel 12 does not exist" is measured
 * against, and it is the working copy's own list because a panel can be split in two.
 */
export function layoutViolations(config: {
  images: ImgTransform[]
  bubbles: BubbleTransform[]
  panels: Panel[]
}): LayoutViolation[] {
  const panelCount = config.panels.length
  return [
    ...pictureViolations(config.images, panelCount),
    ...bubbleViolations(config.bubbles, panelCount),
  ]
}

/** One line per violation — for a test failure message, a log line, or the toolbar. */
export function violationLines(violations: LayoutViolation[]): string[] {
  return violations.map(v => `${v.where} ${v.problem}`)
}
