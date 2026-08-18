import type { BubbleType } from './bubbleTypes'
import type { EditorConfig } from './types'

// Turning the editor's working copy back into `layoutConfig.ts`. The Save button
// POSTs the result to the dev-only write endpoint, which overwrites that file
// verbatim — so anything this module does not emit is deleted on the first save.
// That is why the header prose below lives here rather than only in the file it
// describes: the rule about links staying on one panel is not recoverable from the
// data, and a saved config that had dropped it would read as permission.

/** Round to `decimals` places, dropping float noise (e.g. 1.0000000002 → 1). */
function round(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/** A nullable bubble type as a TS literal — `null` unquoted, a type quoted. */
function typeLiteral(t: BubbleType | null): string {
  return t === null ? 'null' : `'${t}'`
}

const IMG_HEADER = `// Index parallel to PANEL_IMAGES in Layout.tsx. P0 is the logo.
// \`spill: false\` clips the image to the panel polygon (overflow hidden behind the
// panel edge); \`anchor\` is the CSS object-position the framing starts from.`

const BUBBLE_HEADER = `// Not parallel to PANEL_IMAGES: each bubble names its \`panel\`, a panel may own any
// number of them, and the array is ordered by panel only for readability. \`type\`/\`text\`
// are the resting content, \`hoverType\` and \`clickType\` the shapes to morph to on
// pointer-over and press (null = stay put), \`tail\` which way the tail points ('none'
// for no tail), and \`linkTo\` the bubble to join with a connector tube — an index into
// this array, which must name a bubble on the same panel. \`spill: true\` lets a bubble
// float into the gutter.`

/**
 * Serialize a working {@link EditorConfig} into paste-ready TS matching
 * `layoutConfig.ts` (the two `export const` blocks, each under its explanatory
 * comment). Numbers are rounded for clean output: image `scale` to 2 decimals, pixel
 * offsets and bubble percentages to integers, `rotate` to 1 decimal. Bubble `text` is
 * JSON-escaped so quotes/newlines/backslashes stay valid TS.
 */
export function serializeConfig(c: EditorConfig): string {
  const imgLines = c.images
    .map(
      t =>
        `  { scale: ${round(t.scale, 2)}, offsetX: ${Math.round(t.offsetX)}, ` +
        `offsetY: ${Math.round(t.offsetY)}, anchor: '${t.anchor}', spill: ${t.spill} },`,
    )
    .join('\n')
  const bubbleLines = c.bubbles
    .map(
      b =>
        `  { panel: ${b.panel}, top: ${Math.round(b.top)}, right: ${Math.round(b.right)}, ` +
        `width: ${Math.round(b.width)}, rotate: ${round(b.rotate, 1)}, ` +
        `spill: ${b.spill}, type: '${b.type}', tail: '${b.tail}', ` +
        `text: ${JSON.stringify(b.text)}, linkTo: ${b.linkTo}, ` +
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
