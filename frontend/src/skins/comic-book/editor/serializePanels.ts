import type { Panel } from '../panels'
import { strLiteral } from './tsLiteral'

// The `PANELS` block of `layoutConfig.ts`. Its own module rather than a fifth emitter in
// serialize.ts because that file is at its size limit, and because the panel list is the
// one block every other block indexes into — worth reading on its own.

/** Byte-identical with the prose above `PANELS` in `layoutConfig.ts` — see serialize.ts. */
export const PANELS_HEADER = `// The panels themselves: the slots every grid is cut into, and nothing about what is
// drawn inside them. Panel \`i\` is \`PANELS[i]\` everywhere — every grid's ring table,
// PANEL_PATTERNS and the \`panel\` field of every picture and bubble index into this
// list — and only the panels whose \`page\` matches the route carry a ring in that
// page's grids; the rest hold an empty ring and render nothing. The editor appends to
// it when a panel is split (shapes mode: select a panel, then split it), so a new
// panel takes the next index and nothing that names an existing one has to move.`

/**
 * Serialize the panel list as the `PANELS` block. Labels go through {@link strLiteral}
 * because they are typed by the author; `page` is one of two fixed names and is quoted
 * plainly.
 */
export function serializePanels(panels: Panel[]): string {
  const lines = panels
    .map(p => `  { label: ${strLiteral(p.label)}, isLogo: ${p.isLogo}, page: '${p.page}' },`)
    .join('\n')
  return `${PANELS_HEADER}\nexport const PANELS: Panel[] = [\n${lines}\n]\n\n`
}
