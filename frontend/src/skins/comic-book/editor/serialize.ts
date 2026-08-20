import type { BubbleType } from './bubbleTypes'
import type { EditorConfig } from './types'

// Turning the editor's working copy back into `layoutConfig.ts`. The Save button
// POSTs the result to the dev-only write endpoint, which overwrites that file
// verbatim — so anything this module does not emit is deleted on the first save.
// That is why the header prose below lives here rather than only in the file it
// describes: the rule about links staying on one panel is not recoverable from the
// data, and a saved config that had dropped it would read as permission. Keep the two
// headers byte-identical with the ones in `layoutConfig.ts`, so a save with nothing
// changed is a no-op diff rather than a paragraph quietly going missing.

/** Round to `decimals` places, dropping float noise (e.g. 1.0000000002 → 1). */
function round(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/** A nullable bubble type as a TS literal — `null` unquoted, a type quoted. */
function typeLiteral(t: BubbleType | null): string {
  return t === null ? 'null' : `'${t}'`
}

/**
 * An author-typed string as a TS literal, quoted the way the rest of this codebase
 * quotes: single, unless the text holds more apostrophes than double quotes — which is
 * why `"It's Carameli!"` is the one double-quoted string in the shipped config.
 *
 * A plain `JSON.stringify` would be correct TS but would double-quote *every* string,
 * so the first Save rewrote all sixteen lines of a file nobody had edited. A whole-file
 * diff on a no-op save is how a real change goes unreviewed.
 */
function strLiteral(s: string): string {
  const count = (re: RegExp) => (s.match(re) ?? []).length
  const json = JSON.stringify(s)
  if (count(/'/g) > count(/"/g)) return json
  // Re-quote: JSON escaped `"` for us and left `'` alone, so swap which one is escaped.
  return `'${json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`
}

const IMG_HEADER = `// Not parallel to PANELS: each picture names its \`panel\`, so a panel may own several or
// none, and the array is ordered by panel only for readability. \`src\`/\`alt\` are the
// picture itself; \`left\`/\`top\`/\`width\` are its frame, in % of the panel box, and may go
// negative or past 100 to hang it off an edge. \`spill: false\` clips the picture to the
// panel, \`spill: true\` lets it bleed into the gutter — the same question, and the same
// answer, as a bubble's \`spill\`.
//
// There is no \`height\`, and no \`scale\`/\`offsetX\`/\`offsetY\`/\`anchor\` either. A picture's
// height is its width divided by the source's own aspect ratio, exactly as a bubble's
// follows BUBBLE_ASPECT, so the frame *is* the picture's outline: it can be moved and
// resized but never reshaped, and nothing it does can crop the source. Those four fields
// existed to choose which part of a picture survived being forced into a box of the
// wrong shape, and no picture is forced now — with one authored height per panel the
// eight below showed between 38% and 98% of their source, no two framed alike.
//
// The eight ship fitted to their landscape panels: the largest each can be with all of
// it in shot. Panel polygons are oblique, so a picture filling its panel box still has
// its corners cut by the panel while \`spill\` is off — that crop is the panel's, and is
// exactly what the checkbox governs. \`computeLayout\` reshapes every panel between the
// landscape, portrait and square layouts, so these widths suit one of the three: retune
// per layout in the editor and Save.`

const BUBBLE_HEADER = `// Not parallel to PANELS either: each bubble names its \`panel\`, a panel may own any
// number of them, and the array is ordered by panel only for readability. \`type\`/\`text\`
// are the resting content, \`hoverType\` and \`clickType\` the shapes to morph to on
// pointer-over and press (null = stay put), \`tail\` which way the tail points ('none'
// for no tail), and \`linkTo\` the bubble to join with a connector tube — an index into
// this array, which must name a bubble on the same panel. \`spill: true\` keeps the
// current look where bubbles float into the gutter.
//
// Two pairs ship linked — the logo's and the mechanic's — each pair being one speaker's
// line continuing across two balloons, so the second of each carries no tail and the
// tube does the joining. Their placement is nudged off the shared default so the two sit
// apart with a clear gap for the tube to span: overlapping bubbles draw no tube at all
// (tubeBetween returns null rather than a smudge). Those numbers are tuned for the
// landscape layout; the portrait and square layouts reshape the panels, so a pair may
// end up close enough there to drop its tube. Retune per layout in the editor.`

/**
 * Serialize a working {@link EditorConfig} into paste-ready TS matching
 * `layoutConfig.ts` (the two `export const` blocks, each under its explanatory
 * comment).
 *
 * Numbers are rounded for clean output: frame percentages to 1 decimal, bubble
 * percentages to integers, `rotate` to 1. `src`, `alt` and bubble `text` go through
 * {@link strLiteral} so an apostrophe, a quote or a backslash the author typed stays
 * valid TS; the bubble enums come from fixed dropdowns and are quoted plainly.
 */
export function serializeConfig(c: EditorConfig): string {
  const imgLines = c.images
    .map(
      t =>
        `  { panel: ${t.panel}, src: ${strLiteral(t.src)}, alt: ${strLiteral(t.alt)}, ` +
        `left: ${round(t.left, 1)}, top: ${round(t.top, 1)}, ` +
        `width: ${round(t.width, 1)}, spill: ${t.spill} },`,
    )
    .join('\n')
  const bubbleLines = c.bubbles
    .map(
      b =>
        `  { panel: ${b.panel}, top: ${Math.round(b.top)}, right: ${Math.round(b.right)}, ` +
        `width: ${Math.round(b.width)}, rotate: ${round(b.rotate, 1)}, ` +
        `spill: ${b.spill}, type: '${b.type}', tail: '${b.tail}', ` +
        `text: ${strLiteral(b.text)}, linkTo: ${b.linkTo}, ` +
        `hoverType: ${typeLiteral(b.hoverType)}, clickType: ${typeLiteral(b.clickType)} },`,
    )
    .join('\n')
  return (
    `${IMG_HEADER}\nexport const PANEL_IMG_TRANSFORMS: ImgTransform[] = [\n${imgLines}\n]\n\n` +
    `${BUBBLE_HEADER}\nexport const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [\n${bubbleLines}\n]\n`
  )
}

/**
 * Serialize a full, ready-to-write `editor/layoutConfig.ts` file: the type import
 * header plus the two `export const` blocks from {@link serializeConfig}. Used by the
 * editor's Save button, which POSTs this verbatim to the dev-only write endpoint.
 */
export function serializeConfigFile(c: EditorConfig): string {
  return `import type { ImgTransform, BubbleTransform } from './types'\n\n${serializeConfig(c)}`
}
