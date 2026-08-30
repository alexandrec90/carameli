import type { LayoutKind, PageGrids, PanelGrid } from '../panelGeometry'
import { PANEL_PAGES } from '../panels'
import type { Panel } from '../panels'
import { round } from './tsLiteral'

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
function gridBody(grid: PanelGrid, panels: Panel[]): string {
  const points = grid.vertices.map(([x, y]) => `[${round(x, 4)}, ${round(y, 4)}]`).join(', ')
  const rings = grid.panels
    .map((ring, i) => `        [${ring.join(', ')}], // ${panels[i]?.label ?? `panel ${i}`}`)
    .join('\n')
  return `      vertices: [${points}],\n      panels: [\n${rings}\n      ],`
}

/** Serialize every page's panel grids as the PANEL_GRIDS block. */
export function serializeGrids(grids: PageGrids, panels: Panel[]): string {
  const pages = PANEL_PAGES.map(page => {
    const blocks = LAYOUT_KINDS.map(
      kind => `    ${kind}: {\n${gridBody(grids[page][kind], panels)}\n    },`,
    ).join('\n')
    return `  ${page}: {\n${blocks}\n  },`
  }).join('\n')
  return `${GRID_HEADER}\nexport const PANEL_GRIDS: PageGrids = {\n${pages}\n}\n`
}
