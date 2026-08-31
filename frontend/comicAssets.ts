/**
 * How the comic-book picture manifest is kept level with the served directory.
 *
 * `PANEL_ASSETS` (`src/skins/comic-book/editor/assets.ts`) is a hand-written stand-in
 * for a directory listing the browser cannot make, and for as long as it was written by
 * hand it was a step you could forget: art encoded into `public/comic-book/` without a
 * line here is unreachable from the editor's picture dropdown *and* fails
 * `assetPolicy.test.ts` as an export nothing references. `scripts/encode-comic-art.py`
 * has appended the line since it was written, which covers the masters it encodes and
 * nothing else — a `.webp` dropped straight into the served tree stayed invisible, and a
 * deleted one left an entry naming a missing file.
 *
 * These functions are the same reconciliation stated once, as pure text-to-text, so the
 * dev server (`comicAssetsWatch.ts`) can run it on a watcher event. Nothing here touches
 * the filesystem: the caller supplies the directory listing and the current source, and
 * gets the source it should write back.
 *
 * **An existing entry keeps its label.** Several are hand-written and better than
 * anything derivable — `conversation.webp` reads "Two agents talking" — so sync only ever
 * appends what is missing and drops what has gone. Renaming a picture an author named is
 * not this module's call, and `--label` on the encode script stays meaningful.
 */

/** The served directory the dropdown offers from, relative to `frontend/`. */
export const ASSET_DIR_IN_FRONTEND = 'public/comic-book'

/** Where the masters those exports are encoded from live, relative to `frontend/`. */
export const MASTERS_DIR_IN_FRONTEND = 'assets-src/comic-book'

/** The manifest this module rewrites, relative to `frontend/`. */
export const MANIFEST_IN_FRONTEND = 'src/skins/comic-book/editor/assets.ts'

/**
 * Longest edge an export is fitted inside, in px, and its WebP quality.
 *
 * The same two numbers as `DEFAULT_MAX_EDGE` / `DEFAULT_QUALITY` in
 * `scripts/encode-comic-art.py`, which owns them — that script is the documented tool and
 * its docstring argues for both values. They are repeated here because the dev server
 * cannot read them from there: `docker-compose` bind-mounts `frontend/` alone, so
 * `scripts/` is not a path inside the container at all. `test_encode_comic_art.py` reads
 * this file and fails when the two drift, which is the only thing that makes a copy safe.
 */
export const EXPORT_MAX_EDGE = 1408
export const EXPORT_QUALITY = 82

/** Extensions accepted as a master, in the order a bare name resolves. */
export const MASTER_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg']

/**
 * Exports the dropdown never offers.
 *
 * The four `*-cursor.webp` files are pointer chrome loaded by `comic-book.css`, not panel
 * art — 16-32 px drawings that would be offered beside the artwork and draw as a speck in
 * a frame. They are referenced, so `assetPolicy.test.ts` is satisfied without a line in
 * the manifest.
 */
export const CURSOR_SUFFIX = '-cursor.webp'

/** One parsed `PANEL_ASSETS` entry. */
export interface ManifestEntry {
  src: string
  label: string
}

/** True when `fileName` is an export the picture dropdown should offer. */
export function isOfferable(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.webp') && !fileName.toLowerCase().endsWith(CURSOR_SUFFIX)
}

/** `hand-notepad.png` -> `hand-notepad.webp`; the export a master encodes to. */
export function exportNameFor(masterName: string): string {
  return `${masterName.replace(/\.[^.]+$/, '')}.webp`
}

/** True when `fileName` is a master this module knows how to encode. */
export function isMaster(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return MASTER_EXTENSIONS.some(ext => lower.endsWith(ext))
}

/**
 * Percent-encoding as Python's `urllib.parse.quote` spells it, so a URL this module
 * writes is byte-identical to one `scripts/encode-comic-art.py` writes for the same file.
 * `encodeURIComponent` is not that function — it leaves `!'()*` bare — and a manifest
 * where the two tools disagree about `rotary phone.webp` would grow a duplicate entry.
 */
function percentEncode(name: string): string {
  const safe = /[A-Za-z0-9_.\-~]/
  let out = ''
  for (const ch of name) {
    if (safe.test(ch)) {
      out += ch
      continue
    }
    for (const byte of new TextEncoder().encode(ch)) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return out
}

/** The URL the browser requests `fileName` by. */
export function servedUrl(fileName: string): string {
  return `/comic-book/${percentEncode(fileName)}`
}

/**
 * A dropdown label from a file stem: `hand-notepad` -> `Hand notepad`. Deliberately dumb
 * and identical to `derive_label` in the encode script — the label is a placeholder
 * saying which file this is, and an author who wants better writes it in.
 */
export function deriveLabel(stem: string): string {
  const words = stem.trim().split(/[-_\s]+/).filter(Boolean)
  if (words.length === 0) return stem
  const [first, ...rest] = words
  return [first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(), ...rest.map(w => w.toLowerCase())].join(' ')
}

const ENTRY = /^[ \t]*\{ src: '([^']*)', label: '([^']*)' \},?[ \t]*$/gm
const OPEN = 'export const PANEL_ASSETS: PanelAsset[] = ['

/** Every entry currently in `PANEL_ASSETS`, in the order the file lists them. */
export function parseManifest(source: string): ManifestEntry[] {
  const start = source.indexOf(OPEN)
  if (start === -1) return []
  const end = source.indexOf('\n]', start)
  const block = source.slice(start, end === -1 ? undefined : end)
  return [...block.matchAll(ENTRY)].map(m => ({ src: m[1], label: m[2] }))
}

/** One entry formatted the way the file already formats them. */
function entryLine({ src, label }: ManifestEntry): string {
  return `  { src: '${src}', label: '${label}' },`
}

/**
 * A label no existing entry uses. Two entries sharing a label fail
 * `assetPolicy.test.ts` — rightly, since the dropdown would then offer the same word
 * twice — and a derived label can collide with a hand-written one (`mail-carrier.webp`
 * against `mailman1.webp`'s "Mail carrier"). Disambiguating with the file stem keeps the
 * new picture selectable instead of turning a drop-in into a red suite.
 */
function uniqueLabel(label: string, stem: string, taken: Set<string>): string {
  if (!taken.has(label)) return label
  let candidate = `${label} (${stem})`
  let n = 2
  while (taken.has(candidate)) candidate = `${label} (${stem} ${n++})`
  return candidate
}

/** What {@link syncManifest} did, so a caller can log it and skip an unchanged write. */
export interface ManifestSync {
  /** The source to write back — the input verbatim when nothing changed. */
  text: string
  changed: boolean
  /** URLs appended, newest last. */
  added: string[]
  /** URLs dropped because the file is gone. */
  removed: string[]
}

/**
 * Reconcile `PANEL_ASSETS` against the served directory's `fileNames`.
 *
 * **An empty listing is refused**, never obeyed. A read that fails, races a rename, or is
 * pointed at the wrong tree comes back empty, and the obedient reading of that is to
 * delete every line in the manifest — a one-keystroke way to lose thirty hand-written
 * labels to a transient error. There is no legitimate empty state: `logo.webp` has been
 * in that directory since the skin existed.
 */
export function syncManifest(source: string, fileNames: readonly string[]): ManifestSync {
  const unchanged = { text: source, changed: false, added: [], removed: [] }

  const offerable = [...fileNames].filter(isOfferable).sort((a, b) => a.localeCompare(b))
  if (offerable.length === 0) return unchanged

  // An array this module cannot find is one it must not write over. Refusing on the
  // markers rather than on the entry count is what still lets an empty array be filled.
  const start = source.indexOf(OPEN)
  const end = source.indexOf('\n]', start)
  if (start === -1 || end === -1) return unchanged

  const existing = parseManifest(source)
  const urls = new Map(offerable.map(name => [servedUrl(name), name]))
  const kept = existing.filter(entry => urls.has(entry.src))
  const removed = existing.filter(entry => !urls.has(entry.src)).map(entry => entry.src)

  const known = new Set(kept.map(entry => entry.src))
  const labels = new Set(kept.map(entry => entry.label))
  const appended: ManifestEntry[] = []
  for (const [url, name] of urls) {
    if (known.has(url)) continue
    const stem = name.replace(/\.[^.]+$/, '')
    const label = uniqueLabel(deriveLabel(stem), stem, labels)
    labels.add(label)
    appended.push({ src: url, label })
  }

  if (appended.length === 0 && removed.length === 0) return unchanged

  const body = [...kept, ...appended].map(entryLine).join('\n')
  return {
    text: `${source.slice(0, start)}${OPEN}\n${body}${source.slice(end)}`,
    changed: true,
    added: appended.map(entry => entry.src),
    removed,
  }
}

/** Masters with no export yet, in listing order — what a startup sweep has to encode. */
export function mastersNeedingExport(
  masterNames: readonly string[],
  exportNames: readonly string[],
): string[] {
  const have = new Set(exportNames)
  return masterNames.filter(name => isMaster(name) && !have.has(exportNameFor(name)))
}
