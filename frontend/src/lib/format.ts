/**
 * Shared display formatters. Keep all wire→display conversions here so hooks never
 * redefine helpers like duration/date formatting locally (see frontend-style rule).
 */

/** ISO timestamp → `YYYY-MM-DD HH:MM` (empty string for null/empty). */
export function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  return iso.replace('T', ' ').slice(0, 16)
}

/** Seconds → `M:SS` (empty string for null). */
export function formatDuration(sec: number | null): string {
  if (sec == null) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Ratio in [0, 1] → whole-percent string, e.g. `0.5` → `50%`. */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}
