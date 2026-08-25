import type { LayoutKind, PageGrids, PanelGrid } from '../panelGeometry'
import { PANEL_PAGES, PANELS } from '../panels'
import type { BubbleType } from './bubbleTypes'
import { PANEL_PATTERNS } from './layoutConfig'
import { numberPadSuffix } from './serializeNumberPad'
import { tableSuffix } from './serializeTable'
import { round, strLiteral } from './tsLiteral'
import type { EditorConfig } from './types'

// Turning the editor's working copy back into `layoutConfig.ts`. The Save button
// POSTs the result to the dev-only write endpoint, which overwrites that file
// verbatim — so anything this module does not emit is deleted on the first save.
// That is why the header prose below lives here rather than only in the file it
// describes: the rule about links staying on one panel is not recoverable from the
// data, and a saved config that had dropped it would read as permission. Keep the four
// headers byte-identical with the ones in `layoutConfig.ts`, so a save with nothing
// changed is a no-op diff rather than a paragraph quietly going missing.

/** A nullable bubble type as a TS literal — `null` unquoted, a type quoted. */
function typeLiteral(t: BubbleType | null): string {
  return t === null ? 'null' : `'${t}'`
}

const IMG_HEADER = `// Not parallel to PANELS: each picture names its \`panel\`, so a panel may own several or
// none, and the array is ordered by panel only for readability. \`src\`/\`alt\` are the
// picture itself; \`left\`/\`top\`/\`width\`/\`height\` are its frame, in % of the panel box,
// and may go negative or past 100 to hang the frame off an edge. That frame is cut to
// the panel's own polygon scaled into it, so an inset picture reads as a smaller comic
// panel rather than as a bare rectangle. \`scale\`/\`offsetX\`/\`offsetY\`/\`anchor\` then
// frame the picture *inside* its frame; \`spill: false\` clips it there, \`spill: true\`
// lets it bleed past.
//
// A picture with a \`table\` is a **surface**: an HTML table is projected onto it, so a
// photographed notepad can hold live rows. \`quad\` is the four corners of that surface in
// % of the frame, clockwise from top-left, and they are what tilts it — four corners fix
// a projective map exactly, which is what a plane in a photograph needs and three
// rotation angles cannot express. Drag them onto the drawn lines in the editor. \`rows\` is
// how many bands the surface is cut into, so a row always lands on the same line however
// far the reader has scrolled; \`header\` spends the first band on the column labels.
// \`data\` is every row, of which only \`rows\` are on screen at once — the wheel moves a
// whole row at a time and there is no scrollbar. Outside the editor only those values
// show: no outline, no guides, no bar.
//
// A picture with a \`numberPad\` is the other projected surface: the fixed telephone grid
// is three columns by four rows (1–9, then *, 0, #). It uses the same draggable \`quad\`,
// text scale and ink, but the grid is alignment chrome and appears only in the editor;
// readers see the twelve symbols directly on the photographed surface. \`table\` and
// \`numberPad\` are mutually exclusive, so one picture has one projected-content layer.`

const BUBBLE_HEADER = `// Not parallel to PANELS either: each bubble names its \`panel\`, a panel may own any
// number of them, and the array is ordered by panel only for readability. \`type\`/\`text\`
// are the resting content, \`hoverType\` and \`clickType\` the shapes to morph to on
// pointer-over and press (null = stay put), \`tail\` which way the tail points ('none'
// for no tail), and \`linkTo\` the bubble to join with a connector tube — an index into
// this array, which must name a bubble on the same panel. \`spill: true\` keeps the
// current look where bubbles float into the gutter. \`content\` picks how \`text\` reads:
// 'text' letters it as-is; 'wheel' splits it into comma-delimited options; 'input'
// makes it editable; and 'phone' makes it an editable, region-formatted phone number.
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

const GRID_HEADER = `// The panel shapes themselves: one record per page, one grid per viewport shape inside
// it. \`vertices\` are the corners of the whole page in normalised frame space — 0 to 1
// across the frame, y down — and each entry of \`panels\` is one panel as a clockwise
// ring of indices into that table. Every grid's ring table is index-parallel to PANELS
// across *both* pages: a panel that sits on the other page keeps its slot as an empty
// ring, so a panel index means the same thing everywhere.
//
// Corners are **shared**: the divider between two panels is the run of vertices both
// rings name, so moving one moves the line on both sides and the two cannot come apart.
// A vertex added part-way along a divider bends it; repeat that and the divider is a
// lightning bolt.
//
// Two things are deliberately not in here. The **outer frame** is not stored — it is the
// viewport inset by OUTER_M, and a vertex sitting on it may only slide along it, a frame
// corner not at all. Nor is the **gutter**: every panel is shrunk by the same
// HALF_GUTTER perpendicular to each of its own edges as it is drawn, so the margins stay
// equal however far the lines are leant over. Both live in ../panelGeometry.ts, and
// neither is editable — which is what keeps every page on this grid recognisably the
// same page.`

const LAYOUT_KINDS: LayoutKind[] = ['landscape', 'portrait', 'square']

/** One grid's two fields, indented for the record literal that holds it. */
function gridBody(grid: PanelGrid): string {
  const points = grid.vertices.map(([x, y]) => `[${round(x, 4)}, ${round(y, 4)}]`).join(', ')
  const rings = grid.panels
    .map((ring, i) => `        [${ring.join(', ')}], // ${PANELS[i]?.label ?? `panel ${i}`}`)
    .join('\n')
  return `      vertices: [${points}],\n      panels: [\n${rings}\n      ],`
}

/**
 * Serialize every page's panel grids as the `PANEL_GRIDS` block.
 *
 * Vertex coordinates are rounded to 4 places — about a tenth of a pixel on a 1200 px
 * frame, so a drag lands where it was dropped — and the panel rings carry their panel's
 * label as a trailing comment, because a bare row of indices says nothing about which
 * slot of the page it is. An empty ring is emitted as `[]` under the same label: the
 * panel lives on the other page, and its slot stays visible rather than vanishing.
 */
export function serializeGrids(grids: PageGrids): string {
  const pages = PANEL_PAGES.map(page => {
    const blocks = LAYOUT_KINDS.map(kind => `    ${kind}: {\n${gridBody(grids[page][kind])}\n    },`).join('\n')
    return `  ${page}: {\n${blocks}\n  },`
  }).join('\n')
  return `${GRID_HEADER}\nexport const PANEL_GRIDS: PageGrids = {\n${pages}\n}\n`
}

/**
 * Serialize a working {@link EditorConfig} into paste-ready TS matching
 * `layoutConfig.ts` (the four `export const` blocks, each under its explanatory
 * comment).
 *
 * Numbers are rounded for clean output: frame percentages to 1 decimal, image `scale`
 * to 2, pixel offsets and bubble percentages to integers, `rotate` to 1. `src`, `alt`
 * and bubble `text` go through {@link strLiteral} so an apostrophe, a quote or a
 * backslash the author typed stays valid TS; `anchor` and the bubble enums come from
 * fixed dropdowns and are quoted plainly.
 *
 * A projected picture gains one nested block from {@link tableSuffix} or
 * {@link numberPadSuffix}; an ordinary picture gains nothing, so pictures that predate
 * surfaces keep emitting the exact single line they always did. The existing table wins
 * if a hand-edited in-memory config names both, matching hydration and cloning.
 */
export function serializeConfig(c: EditorConfig): string {
  const imgLines = c.images
    .map(
      t =>
        `  { panel: ${t.panel}, src: ${strLiteral(t.src)}, alt: ${strLiteral(t.alt)}, ` +
        `left: ${round(t.left, 1)}, top: ${round(t.top, 1)}, ` +
        `width: ${round(t.width, 1)}, height: ${round(t.height, 1)}, ` +
        `scale: ${round(t.scale, 2)}, offsetX: ${Math.round(t.offsetX)}, ` +
        `offsetY: ${Math.round(t.offsetY)}, anchor: '${t.anchor}', spill: ${t.spill}` +
        `${t.table ? tableSuffix(t.table) : numberPadSuffix(t.numberPad)} },`,
    )
    .join('\n')
  const bubbleLines = c.bubbles
    .map(
      b =>
        `  { panel: ${b.panel}, top: ${Math.round(b.top)}, right: ${Math.round(b.right)}, ` +
        `width: ${Math.round(b.width)}, rotate: ${round(b.rotate, 1)}, ` +
        `spill: ${b.spill}, type: '${b.type}', tail: '${b.tail}', ` +
        `content: '${b.content}', text: ${strLiteral(b.text)}, linkTo: ${b.linkTo}, ` +
        `hoverType: ${typeLiteral(b.hoverType)}, clickType: ${typeLiteral(b.clickType)} },`,
    )
    .join('\n')
  const patternLines = PANELS
    .map((p, i) => `  '${c.patterns[i] ?? PANEL_PATTERNS[i]}', // ${p.label}`)
    .join('\n')
  return (
    `${IMG_HEADER}\nexport const PANEL_IMG_TRANSFORMS: ImgTransform[] = [\n${imgLines}\n]\n\n` +
    `${BUBBLE_HEADER}\nexport const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [\n${bubbleLines}\n]\n\n` +
    `${PATTERN_HEADER}\nexport const PANEL_PATTERNS: PanelBgStyle[] = [\n${patternLines}\n]\n\n` +
    serializeGrids(c.grids)
  )
}

/**
 * Serialize a full, ready-to-write `editor/layoutConfig.ts` file: the import header
 * plus the four `export const` blocks from {@link serializeConfig}. Used by the
 * editor's Save button, which POSTs this verbatim to the dev-only write endpoint.
 */
export function serializeConfigFile(c: EditorConfig): string {
  return (
    `import type { PanelBgStyle } from '../panelPatterns'\n` +
    `import type { ImgTransform, BubbleTransform, PageGrids } from './types'\n\n` +
    serializeConfig(c)
  )
}
