import { strLiteral } from './tsLiteral'

export const PAGE_LABELS_HEADER = `// Route names remain keyed by the app's canonical paths. Only overrides live here:
// a route without one keeps the shared label from routes.ts, while an edited name is
// saved with the rest of this skin's layout.`

/** Serialize the skin-local route label overrides in stable path order. */
export function serializePageLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) {
    return `${PAGE_LABELS_HEADER}\nexport const PAGE_LABELS: Record<string, string> = {}\n\n`
  }
  const lines = entries.map(([path, label]) => `  ${strLiteral(path)}: ${strLiteral(label)},`)
  return (
    `${PAGE_LABELS_HEADER}\nexport const PAGE_LABELS: Record<string, string> = {\n` +
    `${lines.join('\n')}\n}\n\n`
  )
}
