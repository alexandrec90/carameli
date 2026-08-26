// Emitting TypeScript source values. Shared by serialize.ts and serializeTable.ts —
// pulled out of the first when the second arrived, because a projected table's cells go
// through exactly the same quoting rules as a bubble's words and two copies of
// `strLiteral` would be two chances for a saved file to stop matching itself.

/** Round to `decimals` places, dropping float noise (e.g. 1.0000000002 → 1). */
export function round(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
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
export function strLiteral(s: string): string {
  const count = (re: RegExp) => (s.match(re) ?? []).length
  const json = JSON.stringify(s)
  if (count(/'/g) > count(/"/g)) return json
  // Re-quote: JSON escaped `"` for us and left `'` alone, so swap which one is escaped.
  return `'${json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`
}
