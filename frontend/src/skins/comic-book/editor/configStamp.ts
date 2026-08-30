import { seedConfig } from './configSeed'
import type { EditorConfig } from './types'

// Which `layoutConfig.ts` a working copy came from.
//
// Save overwrites that file *whole* — the editor has no notion of a partial write — so a
// tab whose working copy was hydrated from an older version of it silently reverts
// everything that landed in between. That is not hypothetical and it is not rare: it is
// how the call-record table lost its columns (a Save from a tab opened before the feed
// changed shape wrote the old five-column list back over the new four), and it happened
// again during the session that added this module, reverting a merged framing change, a
// panel reordering and a bubble.
//
// Nothing about the file being written says which version it was derived from, so the
// stamp is carried by the working copy itself: the payload records the stamp of the seed
// it was hydrated from and keeps it across every later edit. When the file moves under it
// — a merge, a checkout, another tab's Save — the stamp stops matching the seed the
// bundle now holds, and that mismatch is the whole signal.
//
// It deliberately says only *that* the two differ, never what differs: the file is the
// author's to reconcile, and a diff between a serialized working copy and a file on disk
// is a thing to read in an editor, not in a toolbar.

/**
 * The config as one canonical string: keys in sorted order, so a cloned array or an object
 * rebuilt with its fields in another order — neither of which is a difference an author can
 * see — stamps the same. Written here rather than taken from ./serialize.ts on purpose:
 * this module is reached from `useEditorMode`, which the skin imports whether or not the
 * editor is on, and importing the TypeScript serializer put its 13 KB into every visitor's
 * bundle for a hash. The `test:bundle` budget caught that; the comment is here so the
 * import is not reintroduced as a tidying-up.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(k => `${k}:${canonical(record[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * A short, stable fingerprint of everything a config holds. Taken over the canonical form
 * rather than the object's identity so it changes exactly when the file it would write
 * changes — a reordered key or a cloned array must not read as an edit.
 */
export function configStamp(config: EditorConfig): string {
  const text = canonical(config)
  // FNV-1a, 32-bit: no dependency, no crypto, and collisions here cost a warning that is
  // not shown, not a wrong write.
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** The stamp of the `layoutConfig.ts` this bundle was built from. */
export function seedStamp(): string {
  return configStamp(seedConfig())
}

/**
 * True when a working copy was hydrated from a different `layoutConfig.ts` than the one
 * the bundle now holds — so Save would overwrite whatever changed there.
 *
 * A payload with no stamp (written before this existed) answers false: it may well be
 * stale, but nothing in it says so, and a warning that cannot be trusted is worse than
 * none. Such a payload adopts the current stamp on its next edit, from which point it is
 * tracked like any other.
 */
export function isStaleWorkingCopy(stamp: string | null): boolean {
  return stamp !== null && stamp !== seedStamp()
}
