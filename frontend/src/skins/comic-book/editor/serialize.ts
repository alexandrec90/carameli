import { PANELS } from '../panels'
import type { BubbleType } from './bubbleTypes'
import { PANEL_PATTERNS } from './layoutConfig'
import type { EditorConfig } from './types'

// Turning the editor's working copy back into `layoutConfig.ts`. The Save button
// POSTs the result to the dev-only write endpoint, which overwrites that file
// verbatim — so anything this module does not emit is deleted on the first save.
// That is why the header prose below lives here rather than only in the file it
// describes: the rule about links staying on one panel is not recoverable from the
// data, and a saved config that had dropped it would read as permission. Keep the three
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
// picture itself; \`left\`/\`top\`/\`width\`/\`height\` are its frame, in % of the panel box,
// and may go negative or past 100 to hang the frame off an edge. That frame is cut to
// the panel's own polygon scaled into it, so an inset picture reads as a smaller comic
// panel rather than as a bare rectangle. \`scale\`/\`offsetX\`/\`offsetY\`/\`anchor\` then
// frame the picture *inside* its frame; \`spill: false\` clips it there, \`spill: true\`
// lets it bleed past.`

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

const PATTERN_HEADER = `// The one array here that IS parallel to PANELS: a pattern belongs to the panel slot
// itself, not to a picture or a bubble on it, so entry \`i\` is the Ben-Day background
// drawn behind \`PANELS[i]\` — whichever page that panel sits on. Only the style name is
// the author's choice; the colors and dot metrics stay tuned per panel in
// panelPatterns.ts (PANEL_BG_CONFIGS), so switching a panel's pattern keeps its
// palette. A retired or misspelled name falls back to the shipped default on hydrate
// rather than failing the draw.`

/**
 * Serialize a working {@link EditorConfig} into paste-ready TS matching
 * `layoutConfig.ts` (the three `export const` blocks, each under its explanatory
 * comment).
 *
 * Numbers are rounded for clean output: frame percentages to 1 decimal, image `scale`
 * to 2, pixel offsets and bubble percentages to integers, `rotate` to 1. `src`, `alt`
 * and bubble `text` go through {@link strLiteral} so an apostrophe, a quote or a
 * backslash the author typed stays valid TS; `anchor` and the bubble enums come from
 * fixed dropdowns and are quoted plainly.
 */
export function serializeConfig(c: EditorConfig): string {
  const imgLines = c.images
    .map(
      t =>
        `  { panel: ${t.panel}, src: ${strLiteral(t.src)}, alt: ${strLiteral(t.alt)}, ` +
        `left: ${round(t.left, 1)}, top: ${round(t.top, 1)}, ` +
        `width: ${round(t.width, 1)}, height: ${round(t.height, 1)}, ` +
        `scale: ${round(t.scale, 2)}, offsetX: ${Math.round(t.offsetX)}, ` +
        `offsetY: ${Math.round(t.offsetY)}, anchor: '${t.anchor}', spill: ${t.spill} },`,
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
  // Patterns iterate PANELS, not the config: the array is parallel by contract, so a
  // slot the working copy never touched still serializes as its shipped default.
  const patternLines = PANELS
    .map((p, i) => `  '${c.patterns[i] ?? PANEL_PATTERNS[i]}', // ${p.label}`)
    .join('\n')
  return (
    `${IMG_HEADER}\nexport const PANEL_IMG_TRANSFORMS: ImgTransform[] = [\n${imgLines}\n]\n\n` +
    `${BUBBLE_HEADER}\nexport const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [\n${bubbleLines}\n]\n\n` +
    `${PATTERN_HEADER}\nexport const PANEL_PATTERNS: PanelBgStyle[] = [\n${patternLines}\n]\n`
  )
}

/**
 * Serialize a full, ready-to-write `editor/layoutConfig.ts` file: the type import
 * header plus the three `export const` blocks from {@link serializeConfig}. Used by
 * the editor's Save button, which POSTs this verbatim to the dev-only write endpoint.
 */
export function serializeConfigFile(c: EditorConfig): string {
  return (
    `import type { PanelBgStyle } from '../panelPatterns'\n` +
    `import type { ImgTransform, BubbleTransform } from './types'\n\n${serializeConfig(c)}`
  )
}
