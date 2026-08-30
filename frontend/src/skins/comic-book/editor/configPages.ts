import { cloneConfig } from './configSeed'
import type { EditorConfig } from './types'

/** Keep only route-path → label entries from a persisted page-name override record. */
export function normalizePageLabels(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      ([path, label]) => path.startsWith('/') && typeof label === 'string',
    ),
  )
}

/** Rename one route for this skin without changing the route that navigation uses. */
export function setPageLabel(
  config: EditorConfig,
  path: string,
  label: string,
): EditorConfig {
  const next = cloneConfig(config)
  next.pageLabels[path] = label
  return next
}
